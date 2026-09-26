Forge IDE x Unity — setup guide
==============================

WHAT YOU GET
1) Built-in unity_* tools (no Unity setup needed):
   unity_detect   — is this folder a Unity project? (checks Assets/ + ProjectSettings/)
   unity_editors  — list installed Unity Editors (Unity Hub, UNITY_PATH, PATH)
   unity_script   — write a C# script (behaviour / editor / mesh / custom)
                    mesh template builds geometry in code = "make models" with no files
   unity_build    — headless player build (Win64/macOS/Linux64 need nothing else)
   unity_run      — run a static C# method headless (-executeMethod)
   unity_test     — run EditMode tests headless
   unity_log      — tail the Editor log (compile errors, exceptions)

   Typical AI workflow: unity_detect -> unity_script -> unity_build -> unity_log.

2) Live Editor link (full access: console, play mode, scene, exec):
   a) Copy ForgeBridge.cs into your Unity project:
        Assets/Editor/Forge/ForgeBridge.cs
   b) Open the project in the Unity Editor (bridge listens on 127.0.0.1:8091).
   c) Add the MCP server to ~/.forge-ide/config.json:
        "MCP_SERVERS": [
          { "name": "unity", "command": "node",
            "args": ["<forge-ide>/assets/unity/forge-unity-mcp.js"] }
        ]
      (Replace <forge-ide> with the real path, e.g.
       C:/Users/you/AppData/Roaming/npm/node_modules/forge-ide)
   d) Restart Forge IDE, then run /mcp list — you should see unity__ping etc.
   e) The AI can now: read console errors, enter/exit play mode, refresh the
      AssetDatabase, create primitives, list the scene, and run any static
      C# method (unity__exec) — e.g. a builder that generates models/prefabs.

PORT: 8091 loopback only (env FORGE_UNITY_PORT overrides).
Android/iOS/WebGL builds need ForgeBridge.cs installed (BuildPlayer lives there).
