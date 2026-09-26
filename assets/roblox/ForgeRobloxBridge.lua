-- ForgeRobloxBridge.lua — Forge IDE live link for Roblox Studio.
--
-- INSTALL (one time):
--   1. Copy this file into your Studio Plugins folder:
--        Windows: %LOCALAPPDATA%\Roblox\Plugins\
--        macOS:   ~/Documents/Roblox/Plugins/
--   2. Restart Roblox Studio. A "Forge" toolbar appears; the Link button
--      toggles the connection. It polls http://127.0.0.1:8092 for commands.
--   3. In ~/.forge-ide/config.json add to MCP_SERVERS:
--        { "name": "roblox", "command": "node",
--          "args": ["C:/path/to/forge-roblox-mcp.js"] }
--      (see assets/roblox/README.txt). Then the AI gets roblox__* tools.
--
-- The plugin only listens on loopback (your own machine). Nothing leaves it.

local BRIDGE_URL = "http://127.0.0.1:8092"
local POLL_SECONDS = 2

local HttpService = game:GetService("HttpService")
local LogService = game:GetService("LogService")

local function log(msg)
	print("[ForgeBridge] " .. tostring(msg))
end

local function runCommand(cmd)
	local op = cmd.op

	if op == "ping" then
		return { ok = true, place = game.Name, studio = true }

	elseif op == "console" then
		local kinds = cmd.kinds or "all"
		local limit = math.min(tonumber(cmd.limit) or 50, 200)
		local out = {}
		local okHist, hist = pcall(function()
			return LogService:GetLogHistory()
		end)
		if okHist and hist then
			for i = math.max(1, #hist - limit + 1), #hist do
				local e = hist[i]
				local mt = tostring(e.messageType or "Unknown")
				local want = kinds == "all"
					or (kinds == "error" and mt:find("Error"))
					or (kinds == "warning" and mt:find("Warning"))
				if want then
					table.insert(out, ("[%s] %s"):format(mt, tostring(e.message)))
				end
			end
		end
		return { ok = true, entries = out }

	elseif op == "tree" then
		local acc = {}
		local function kids(inst, depth)
			if #acc >= 120 then
				return
			end
			for _, child in ipairs(inst:GetChildren()) do
				if #acc >= 120 then
					return
				end
				table.insert(acc, string.rep("  ", depth) .. child.ClassName .. " " .. child.Name)
				if depth < 2 then
					kids(child, depth + 1)
				end
			end
		end
		kids(game, 0)
		return { ok = true, tree = acc }

	elseif op == "createscript" then
		local className = cmd.className or "Script"
		if className ~= "Script" and className ~= "LocalScript" and className ~= "ModuleScript" then
			return { ok = false, error = "className must be Script, LocalScript or ModuleScript" }
		end
		local parent = game
		for part in string.gmatch(cmd.parent or "ServerScriptService", "[^%.]+") do
			parent = parent:FindFirstChild(part)
			if not parent then
				return { ok = false, error = "parent not found: " .. tostring(cmd.parent) }
			end
		end
		local inst = Instance.new(className)
		inst.Name = cmd.name or "ForgeScript"
		local okSrc, errSrc = pcall(function()
			inst.Source = cmd.source or ""
		end)
		if not okSrc then
			inst:Destroy()
			return { ok = false, error = "bad source: " .. tostring(errSrc) }
		end
		inst.Parent = parent
		return { ok = true, path = parent:GetFullName() .. "." .. inst.Name }

	elseif op == "exec" then
		local lines = {}
		local oldPrint = print
		print = function(...)
			local parts = {}
			for i = 1, select("#", ...) do
				parts[i] = tostring(select(i, ...))
			end
			table.insert(lines, table.concat(parts, " "))
		end
		local fn, loadErr = loadstring(cmd.code or "return nil")
		local ret = nil
		if fn then
			local okRun, val = pcall(fn)
			if okRun then
				ret = val
			else
				loadErr = val
			end
		end
		print = oldPrint
		if loadErr ~= nil then
			return { ok = false, output = table.concat(lines, "\n"), error = tostring(loadErr) }
		end
		return { ok = true, output = table.concat(lines, "\n"), value = tostring(ret) }

	else
		return { ok = false, error = "unknown op: " .. tostring(op) }
	end
end

local running = true
pcall(function()
	local toolbar = plugin:CreateToolbar("Forge")
	local btn = toolbar:CreateButton("Link", "Toggle the Forge IDE live link", "")
	btn:SetActive(true)
	btn.Click:Connect(function()
		running = not running
		btn:SetActive(running)
		log(running and "link on" or "link off")
	end)
end)

log("polling " .. BRIDGE_URL .. " ...")
while true do
	if running then
		local ok, body = pcall(function()
			return HttpService:GetAsync(BRIDGE_URL .. "/pending", true)
		end)
		if ok and body then
			local okDec, cmd = pcall(function()
				return HttpService:JSONDecode(body)
			end)
			if okDec and cmd and cmd.id then
				local res = nil
				local okRun, errRun = pcall(function()
					res = runCommand(cmd)
				end)
				if not okRun then
					res = { ok = false, error = "bridge crash: " .. tostring(errRun) }
				end
				res.id = cmd.id
				pcall(function()
					HttpService:PostAsync(
						BRIDGE_URL .. "/result",
						HttpService:JSONEncode(res),
						Enum.HttpContentType.ApplicationJson
					)
				end)
			end
		end
	end
	task.wait(POLL_SECONDS)
end
