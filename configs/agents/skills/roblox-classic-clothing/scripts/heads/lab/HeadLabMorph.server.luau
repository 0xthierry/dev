-- HeadsLab in Play: turn into any NPC. A pad in front of each NPC in workspace.HeadLab (or a click on the NPC) respawns
-- the player where they stand as that NPC: its body and catalog accessories (Player:LoadCharacterWithHumanoidDescription
-- with the NPC's applied description), then its clothes, our pieces and our NPC head with its face. The "Me" pad gives
-- the player's own avatar back. The native head uses a built-in URI. Session-local face textures and generated pieces
-- carry attributes so each client can restore them (see HeadLab.rebuild).
local Players = game:GetService("Players")

local folder = workspace:WaitForChild("HeadLab")
local pads = Instance.new("Folder")
pads.Name = "HeadLabPads"
pads.Parent = workspace

local busy, current = {}, {}

local function morph(player: Player, npc: Model?)
	if busy[player] or current[player] == npc then
		return
	end
	busy[player] = true
	local ok, err = pcall(function()
		local where = player.Character and player.Character:GetPivot()
		if npc then
			local desc = npc:FindFirstChildOfClass("Humanoid"):GetAppliedDescription()
			player:LoadCharacterWithHumanoidDescription(desc)
		else
			player:LoadCharacter()
		end
		local character = player.Character
		if where then
			character:PivotTo(where)
		end
		current[player] = npc
		if not npc then
			return
		end
		local humanoid = character:WaitForChild("Humanoid")
		for _, c in npc:GetChildren() do
			if c:IsA("Shirt") or c:IsA("Pants") then
				c:Clone().Parent = character
			elseif c:IsA("Accessory") and c:FindFirstChild("Handle") and c.Handle:GetAttribute("HeadLabPiece") then
				humanoid:AddAccessory(c:Clone())
			end
		end
		local face = npc.Head:GetAttribute("HeadLabFace")
		if face then
			local head = character:WaitForChild("Head")
			head:SetAttribute("HeadLabSkin", npc.Head:GetAttribute("HeadLabSkin"))
			head:SetAttribute("HeadLabFace", face)
		end
	end)
	if not ok then
		warn("HeadLab morph failed:", err)
	end
	task.delay(1.5, function()
		busy[player] = nil
	end)
end

local function pad(name: string, at: Vector3, colour: Color3, onTouch: (Player) -> ())
	local p = Instance.new("Part")
	p.Name = name
	p.Anchored, p.CanCollide = true, false
	p.Size = Vector3.new(2.6, 0.3, 2.6)
	p.Material, p.Color = Enum.Material.Neon, colour
	p.Position = at
	local gui = Instance.new("BillboardGui")
	gui.Size, gui.StudsOffset, gui.AlwaysOnTop = UDim2.fromOffset(170, 34), Vector3.new(0, 1.4, 0), true
	local label = Instance.new("TextLabel")
	label.Size, label.BackgroundTransparency, label.TextScaled = UDim2.fromScale(1, 1), 0.35, true
	label.BackgroundColor3, label.TextColor3, label.Text = Color3.new(0, 0, 0), Color3.new(1, 1, 1), name
	label.Parent = gui
	gui.Parent = p
	p.Touched:Connect(function(hit)
		local player = Players:GetPlayerFromCharacter(hit.Parent)
		if player then
			onTouch(player)
		end
	end)
	p.Parent = pads
	return p
end

local function addNpc(npc: Instance)
	if not npc:IsA("Model") or not npc:FindFirstChildOfClass("Humanoid") then
		return
	end
	local pivot = npc:GetPivot()
	local front = Vector3.new(pivot.LookVector.X, 0, pivot.LookVector.Z).Unit
	pad(npc.Name, Vector3.new(pivot.X, 0.15, pivot.Z) + front * 3, Color3.fromRGB(255, 196, 64), function(player)
		morph(player, npc)
	end)
	local click = Instance.new("ClickDetector")
	click.MaxActivationDistance = 60
	click.MouseClick:Connect(function(player)
		morph(player, npc)
	end)
	click.Parent = npc
end

for _, npc in folder:GetChildren() do
	addNpc(npc)
end
folder.ChildAdded:Connect(addNpc)
pad("Me", Vector3.new(-4, 0.15, 7), Color3.fromRGB(90, 200, 255), function(player)
	morph(player, nil)
end)
Players.PlayerRemoving:Connect(function(player)
	busy[player], current[player] = nil, nil
end)
