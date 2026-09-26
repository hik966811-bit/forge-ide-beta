// ForgeBridge.cs — Forge IDE live link for the Unity Editor.
//
// INSTALL: copy this file into your Unity project at:
//     Assets/Editor/Forge/ForgeBridge.cs
// Then open the project in the Unity Editor. The bridge listens on
// 127.0.0.1:8091 (loopback only) while the Editor is open.
//
// The Forge AI talks to it directly (console errors, play mode, scene ops,
// running static methods, player builds) — no Unity setup beyond this file.
//
// PROTOCOL: one JSON object per line over TCP, one JSON reply per line.
//   {"cmd":"ping"} -> {"ok":true,"unity":"2022.3.1f1","scene":"Assets/Scenes/Main.unity"}
//   {"cmd":"console","kinds":"error","limit":50}
//   {"cmd":"play"} / {"cmd":"stop"} / {"cmd":"refresh"}
//   {"cmd":"create","shape":"Cube","name":"ForgeBox","pos":[0,1,0]}
//   {"cmd":"exec","method":"MyBuilder.BuildAll"}
//   {"cmd":"scene"} -> active scene path + root object names
//
// Used by: Forge IDE unity_build (Android/iOS/WebGL targets) and the
// forge-unity-mcp.js MCP server (configure via MCP_SERVERS in
// ~/.forge-ide/config.json to give the AI live Editor access).
#if UNITY_EDITOR
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class ForgeBridge
{
    const int Port = 8091;

    static TcpListener _listener;
    static Thread _thread;
    static readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
    static readonly List<LogEntry> _logs = new List<LogEntry>();
    const int MaxLogs = 500;

    struct LogEntry
    {
        public string kind;
        public string message;
        public string stack;
        public string time;
    }

    [InitializeOnLoadMethod]
    static void Start()
    {
        Application.logMessageReceived += OnLog;
        EditorApplication.update += Pump;
        try
        {
            if (_listener != null) return;
            _listener = new TcpListener(IPAddress.Loopback, Port);
            _listener.Start();
            _thread = new Thread(AcceptLoop) { IsBackground = true, Name = "ForgeBridge" };
            _thread.Start();
        }
        catch (Exception e)
        {
            Debug.LogWarning("[ForgeBridge] Could not listen on 127.0.0.1:" + Port + " — " + e.Message);
        }
    }

    static void OnLog(string message, string stack, LogType type)
    {
        lock (_logs)
        {
            _logs.Add(new LogEntry
            {
                kind = type.ToString(),
                message = message ?? "",
                stack = (type == LogType.Error || type == LogType.Exception) ? (stack ?? "") : "",
                time = DateTime.Now.ToString("HH:mm:ss"),
            });
            while (_logs.Count > MaxLogs) _logs.RemoveAt(0);
        }
    }

    static void Pump()
    {
        while (_mainThread.TryDequeue(out var a))
        {
            try { a(); } catch (Exception e) { Debug.LogError("[ForgeBridge] " + e.Message); }
        }
    }

    static void AcceptLoop()
    {
        while (true)
        {
            try
            {
                var client = _listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(Handle, client);
            }
            catch { return; }
        }
    }

    static void Handle(object state)
    {
        var client = (TcpClient)state;
        try
        {
            using (client)
            using (var stream = client.GetStream())
            {
                var buf = new byte[65536];
                var sb = new StringBuilder();
                stream.ReadTimeout = 30000;
                int n;
                while ((n = stream.Read(buf, 0, buf.Length)) > 0)
                {
                    sb.Append(Encoding.UTF8.GetString(buf, 0, n));
                    if (sb.ToString().Contains("\n")) break;
                }
                string request = sb.ToString().Trim();
                string reply = Dispatch(request);
                byte[] outBytes = Encoding.UTF8.GetBytes(reply + "\n");
                stream.Write(outBytes, 0, outBytes.Length);
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning("[ForgeBridge] request failed: " + e.Message);
        }
    }

    // --- command dispatch (runs on socket thread; Unity API via main thread) ---

    static string Dispatch(string json)
    {
        var req = MiniJson.Parse(json);
        string cmd = MiniJson.Str(req, "cmd");
        var done = new ManualResetEventSlim(false);
        string reply = "{\"ok\":false,\"error\":\"unknown command: " + cmd + "\"}";
        _mainThread.Enqueue(() =>
        {
            try { reply = RunCommand(cmd, req); }
            catch (Exception e) { reply = "{\"ok\":false,\"error\":" + MiniJson.Quote(e.Message) + "}"; }
            done.Set();
        });
        done.Wait(TimeSpan.FromSeconds(60));
        return reply;
    }

    static string RunCommand(string cmd, Dictionary<string, object> req)
    {
        switch (cmd)
        {
            case "ping":
                return "{\"ok\":true,\"unity\":" + MiniJson.Quote(Application.unityVersion) +
                       ",\"scene\":" + MiniJson.Quote(SceneManager.GetActiveScene().path) + "}";
            case "console": {
                string kinds = MiniJson.Str(req, "kinds");
                int limit = (int)MiniJson.Num(req, "limit", 50);
                var items = new List<string>();
                lock (_logs)
                {
                    for (int i = _logs.Count - 1; i >= 0 && items.Count < limit; i--)
                    {
                        var l = _logs[i];
                        if (kinds == "error" && l.kind != "Error" && l.kind != "Exception") continue;
                        if (kinds == "warning" && l.kind != "Warning") continue;
                        items.Add("{\"time\":" + MiniJson.Quote(l.time) + ",\"kind\":" + MiniJson.Quote(l.kind) +
                                  ",\"message\":" + MiniJson.Quote(Trunc(l.message, 800)) +
                                  ",\"stack\":" + MiniJson.Quote(Trunc(l.stack, 800)) + "}");
                    }
                }
                items.Reverse();
                return "{\"ok\":true,\"logs\":[" + string.Join(",", items) + "]}";
            }
            case "play":
                EditorApplication.isPlaying = true;
                return "{\"ok\":true,\"playing\":true}";
            case "stop":
                EditorApplication.isPlaying = false;
                return "{\"ok\":true,\"playing\":false}";
            case "refresh":
                AssetDatabase.Refresh();
                return "{\"ok\":true}";
            case "scene": {
                var scene = SceneManager.GetActiveScene();
                var roots = new List<string>();
                foreach (var go in scene.GetRootGameObjects()) roots.Add(MiniJson.Quote(go.name));
                return "{\"ok\":true,\"path\":" + MiniJson.Quote(scene.path) +
                       ",\"roots\":[" + string.Join(",", roots) + "]}";
            }
            case "create": {
                string shape = MiniJson.Str(req, "shape");
                if (string.IsNullOrEmpty(shape)) shape = "Cube";
                string name = MiniJson.Str(req, "name");
                var pos = MiniJson.Vec(req, "pos");
                GameObject go;
                try { go = GameObject.CreatePrimitive((PrimitiveType)Enum.Parse(typeof(PrimitiveType), shape, true)); }
                catch { go = new GameObject(string.IsNullOrEmpty(name) ? shape : name); }
                if (!string.IsNullOrEmpty(name)) go.name = name;
                go.transform.position = pos;
                Undo.RegisterCreatedObjectUndo(go, "Forge create");
                EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
                return "{\"ok\":true,\"name\":" + MiniJson.Quote(go.name) + "}";
            }
            case "exec": {
                string method = MiniJson.Str(req, "method");
                var target = FindStaticMethod(method);
                if (target == null) return "{\"ok\":false,\"error\":" + MiniJson.Quote("static void method not found: " + method) + "}";
                target.Invoke(null, null);
                AssetDatabase.Refresh();
                return "{\"ok\":true,\"ran\":" + MiniJson.Quote(method) + "}";
            }
            default:
                return "{\"ok\":false,\"error\":" + MiniJson.Quote("unknown command: " + cmd) + "}";
        }
    }

    static System.Reflection.MethodInfo FindStaticMethod(string dotted)
    {
        if (string.IsNullOrEmpty(dotted)) return null;
        int dot = dotted.LastIndexOf('.');
        if (dot < 0) return null;
        string typeName = dotted.Substring(0, dot);
        string methodName = dotted.Substring(dot + 1);
        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            Type t;
            try { t = asm.GetType(typeName); } catch { continue; }
            if (t == null) continue;
            var m = t.GetMethod(methodName,
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic |
                System.Reflection.BindingFlags.Static);
            if (m != null && m.GetParameters().Length == 0) return m;
        }
        return null;
    }

    // --- batch-mode player build (used by Forge unity_build for mobile/WebGL) ---
    // Called as: Unity -batchmode -projectPath <proj> -executeMethod ForgeBridge.BuildPlayer
    //   -forgeBuildTarget Android -forgeBuildPath <out> -quit

    public static void BuildPlayer()
    {
        string targetName = ArgValue("-forgeBuildTarget") ?? "Win64";
        string outPath = ArgValue("-forgeBuildPath") ?? "Builds/Player";
        BuildTarget target = BuildTarget.StandaloneWindows64;
        string ext = ".exe";
        try
        {
            switch (targetName)
            {
                case "Win64": target = BuildTarget.StandaloneWindows64; ext = ".exe"; break;
                case "macOS": target = BuildTarget.StandaloneOSX; ext = ".app"; break;
                case "Linux64": target = BuildTarget.StandaloneLinux64; ext = ""; break;
                case "Android": target = BuildTarget.Android; ext = ".apk"; break;
                case "iOS": target = BuildTarget.iOS; ext = ""; break;
                case "WebGL": target = BuildTarget.WebGL; ext = ""; break;
                default:
                    Debug.LogError("[ForgeBridge] Unknown build target: " + targetName);
                    EditorApplication.Exit(2);
                    return;
            }
        }
        catch (Exception e)
        {
            Debug.LogError("[ForgeBridge] Build target not supported by this Unity version: " + e.Message);
            EditorApplication.Exit(2);
            return;
        }
        if (!outPath.EndsWith(ext, StringComparison.OrdinalIgnoreCase) && ext.Length > 0)
            outPath = System.IO.Path.Combine(outPath, "Player" + ext);

        var scenes = new List<string>();
        foreach (var s in EditorBuildSettings.scenes)
            if (s.enabled) scenes.Add(s.path);

        var report = UnityEditor.BuildPipeline.BuildPlayer(scenes.ToArray(), outPath, target, BuildOptions.None);
        Debug.Log("[ForgeBridge] Build result: " + report.summary.result + " -> " + outPath);
        EditorApplication.Exit(report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded ? 0 : 1);
    }

    static string ArgValue(string flag)
    {
        var args = Environment.GetCommandLineArgs();
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == flag) return args[i + 1];
        return null;
    }

    static string Trunc(string s, int n)
    {
        if (string.IsNullOrEmpty(s)) return "";
        return s.Length <= n ? s : s.Substring(0, n) + "...";
    }

    // --- minimal JSON (flat objects + arrays of numbers) ---

    static class MiniJson
    {
        public static Dictionary<string, object> Parse(string json)
        {
            var d = new Dictionary<string, object>();
            if (string.IsNullOrEmpty(json)) return d;
            int i = 0;
            Skip(json, ref i);
            if (i < json.Length && json[i] == '{') { i++; ParseObj(json, ref i, d); }
            return d;
        }

        static void ParseObj(string s, ref int i, Dictionary<string, object> d)
        {
            while (i < s.Length)
            {
                Skip(s, ref i);
                if (i >= s.Length) return;
                if (s[i] == '}') { i++; return; }
                if (s[i] == ',') { i++; continue; }
                if (s[i] != '"') { i++; continue; }
                string key = ReadStr(s, ref i);
                Skip(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                d[key] = ReadVal(s, ref i);
            }
        }

        static object ReadVal(string s, ref int i)
        {
            Skip(s, ref i);
            if (i >= s.Length) return null;
            if (s[i] == '"') return ReadStr(s, ref i);
            if (s[i] == '[')
            {
                i++;
                var list = new List<object>();
                while (i < s.Length && s[i] != ']')
                {
                    if (s[i] == ',') { i++; continue; }
                    list.Add(ReadVal(s, ref i));
                    Skip(s, ref i);
                }
                if (i < s.Length) i++;
                return list;
            }
            int start = i;
            while (i < s.Length && ",}]\"".IndexOf(s[i]) < 0) i++;
            string tok = s.Substring(start, i - start).Trim();
            double n;
            if (double.TryParse(tok, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out n)) return n;
            if (tok == "true") return true;
            if (tok == "false") return false;
            return tok;
        }

        static string ReadStr(string s, ref int i)
        {
            i++; // opening quote
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < s.Length)
                {
                    char e = s[i++];
                    sb.Append(e == 'n' ? '\n' : e == 't' ? '\t' : e == 'r' ? '\r' : e);
                }
                else sb.Append(c);
            }
            return sb.ToString();
        }

        static void Skip(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) ? Convert.ToString(v) : "";
        }

        public static double Num(Dictionary<string, object> d, string key, double def)
        {
            object v;
            if (!d.TryGetValue(key, out v)) return def;
            try { return Convert.ToDouble(v); } catch { return def; }
        }

        public static Vector3 Vec(Dictionary<string, object> d, string key)
        {
            object v = null;
            if (d.TryGetValue(key, out v)) { /* fall through */ }
            var list = v as List<object>;
            if (list == null || list.Count < 3) return Vector3.zero;
            return new Vector3((float)Num2(list[0]), (float)Num2(list[1]), (float)Num2(list[2]));
        }

        static double Num2(object v)
        {
            try { return Convert.ToDouble(v); } catch { return 0; }
        }

        public static string Quote(string s)
        {
            if (s == null) return "\"\"";
            return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"")
                .Replace("\n", "\\n").Replace("\r", "\\r").Replace("\t", "\\t") + "\"";
        }
    }
}
#endif
