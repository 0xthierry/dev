-- HeadsLab in Play: the heads and pieces built in edit mode come up as plain boxes (their EditableMesh and
-- EditableImage stayed in the edit session), so each client rebuilds them from the packed data (HeadLab.rebuild).
-- A morphed player (HeadLabMorph) gets the same: copied pieces arrive with their attributes, and the head's face
-- attribute may be set just after the character appears.
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local H = require(ReplicatedStorage:WaitForChild("HeadLab"))

local building = {}
local function build(part: MeshPart)
	if building[part] then -- our own ApplyMesh and texture changes fire the signals below
		return
	end
	building[part] = true
	local ok, err = pcall(H.rebuild, part)
	building[part] = nil
	if not ok then
		warn("HeadLab rebuild failed:", err)
	end
end

local function rebuild(inst: Instance)
	if not inst:IsA("MeshPart") then
		return
	end
	if inst:GetAttribute("HeadLabFace") or inst:GetAttribute("HeadLabPiece") then
		task.spawn(build, inst)
	end
	if inst.Name == "Head" then
		-- the face may be set after the character appears, and a character's appearance loading on the server can set
		-- the head's mesh and texture after we rebuilt it: rebuild again whenever either happens
		local function again()
			if inst:GetAttribute("HeadLabFace") then
				task.spawn(build, inst)
			end
		end
		inst:GetAttributeChangedSignal("HeadLabFace"):Connect(again)
		inst:GetPropertyChangedSignal("MeshContent"):Connect(again)
		inst:GetPropertyChangedSignal("TextureContent"):Connect(again)
	end
end

for _, inst in workspace:GetDescendants() do
	rebuild(inst)
end
workspace.DescendantAdded:Connect(rebuild)
