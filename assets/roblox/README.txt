FORGE IDE x ROBLOX STUDIO — setup guide
=========================================

Two levels. Level 1 works with zero Studio setup. Level 2 gives the AI
live access to your open Studio place.

LEVEL 1 — files only (no setup)
--------------------------------
1. Open your Roblox/Rojo folder as the Forge workspace.
2. Tell the AI, e.g.:
     "detect the roblox project, then write a coin collector server script"
3. Tools available with nothing installed:
     roblox_detect  find Rojo project / .rbxl places
     roblox_init    scaffold a Rojo project (default.project.json + src/)
     roblox_script  write Luau (serverscript, localscript, module, test)
     roblox_place   describe the project (tree services, files)
4. With free command-line tools installed you also get:
     roblox_lune    run Luau tests outside Studio (needs Lune)
     roblox_rojo    build a .rbxl place file (needs Rojo)
   Install:  https://rojo.space/docs/installation
             https://lune-org.github.io/docs
   Optional: remodel (patch .rbxl headlessly), Rojo Studio plugin
   (live file sync — install it from the Studio Plugin Marketplace,
   then `rojo serve` in the project root via start_process).

LEVEL 2 — live Studio link (one-time setup, ~3 minutes)
--------------------------------------------------------
1. Copy ForgeRobloxBridge.lua (this folder) into the Studio Plugins folder:
     Windows: %LOCALAPPDATA%\Roblox\Plugins\
     macOS:   ~/Documents/Roblox/Plugins/
   Restart Studio. A "Forge" toolbar appears; the Link button toggles it.
   The plugin polls http://127.0.0.1:8092 (your own machine only).
2. In ~/.forge-ide/config.json add to MCP_SERVERS:
     "MCP_SERVERS": [
       {
         "name": "roblox",
         "command": "node",
         "args": [
           "C:\\Users\\nopa8\\AppData\\Roaming\\npm\\node_modules\\forge-ide\\assets\\roblox\\forge-roblox-mcp.js"
         ]
       }
     ]
   (Adjust the path if your install lives elsewhere. Set the
   FORGE_ROBLOX_PORT env var in the entry if 8092 is taken.)
3. Restart Forge. /mcp list should show the roblox__* tools.
4. Open any place in Studio, then tell the AI, e.g.:
     "check the Studio console for errors and fix them"
     "list everything in workspace"
     "run this Luau in Studio: for _,c in ipairs(workspace:GetChildren()) do print(c.Name) end"

LIVE TOOLS (roblox__* via MCP)
-------------------------------
  roblox_ping          place name / link check
  roblox_console       Studio output log (all/error/warning)
  roblox_tree          DataModel tree (services + top instances)
  roblox_createscript  create a live Script/LocalScript/ModuleScript
  roblox_exec          run arbitrary Luau in the open place, get output

NOTES
-----
- Luau files use the .luau extension (Studio + Rojo accept .lua too).
- Rojo serve port (34872) and the Forge bridge port (8092) are different
  things; both can run at once.
- The bridge never touches the internet — loopback only.
