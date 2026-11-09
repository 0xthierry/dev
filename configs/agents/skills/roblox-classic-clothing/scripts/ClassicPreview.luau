--!nocheck
-- Classic clothing preview in Studio edit mode, with or without uploading the templates. Paste into the command bar
-- (or run through the Studio MCP) with relay.py serving the textures from composite.py; it installs
-- _G.ClassicPreview. It turns HttpService.HttpEnabled on only while fetching, then restores it.
--   P.rig(name, cframe, skin?, groundY?)   a default Blocky R15 rig in workspace.ClassicPreview, root anchored, on the ground
--   P.dress(model, dir)                    each body part's TextureContent = <dir>/<Part>.png from the relay (no upload)
--   P.wear(model, shirtId?, pantsId?)      the real thing: Shirt/Pants with uploaded image IDs, Roblox's own compositor
--   P.pose(model, anim, t)                 freeze a pose: anim is an Animation, an AnimationClip or an "rbxassetid://" id
--   P.lineup(dirs, origin, spacing?)       one dressed rig per relay folder, in a row along +X, facing -Z
local HttpService = game:GetService("HttpService")
local AssetService = game:GetService("AssetService")
local Players = game:GetService("Players")

local RELAY = "http://127.0.0.1:8767/"
local PARTS = {
	"UpperTorso",
	"LowerTorso",
	"LeftUpperArm",
	"LeftLowerArm",
	"LeftHand",
	"RightUpperArm",
	"RightLowerArm",
	"RightHand",
	"LeftUpperLeg",
	"LeftLowerLeg",
	"LeftFoot",
	"RightUpperLeg",
	"RightLowerLeg",
	"RightFoot",
}

local P = {}

function P.fetch(path: string): EditableImage
	local was = HttpService.HttpEnabled
	HttpService.HttpEnabled = true
	local ok, res = pcall(HttpService.RequestAsync, HttpService, { Url = RELAY .. path .. ".rgba", Method = "GET" })
	HttpService.HttpEnabled = was
	assert(ok and res.Success, "fetch failed: " .. path .. " (is relay.py running on its folder's parent?)")
	local w, h = string.match(res.Headers["x-size"], "(%d+),(%d+)")
	local size = Vector2.new(tonumber(w), tonumber(h))
	local img = AssetService:CreateEditableImage({ Size = size })
	img:WritePixelsBuffer(Vector2.zero, size, buffer.fromstring(res.Body))
	return img
end

function P.rig(name: string, cframe: CFrame, skin: Color3?, groundY: number?): Model
	local d = Instance.new("HumanoidDescription")
	local c = skin or Color3.fromRGB(234, 184, 146)
	d.HeadColor, d.TorsoColor, d.LeftArmColor, d.RightArmColor, d.LeftLegColor, d.RightLegColor = c, c, c, c, c, c
	local model = Players:CreateHumanoidModelFromDescriptionAsync(d, Enum.HumanoidRigType.R15)
	model.Name = name
	model.HumanoidRootPart.Anchored = true
	local folder = workspace:FindFirstChild("ClassicPreview") or Instance.new("Folder")
	folder.Name = "ClassicPreview"
	folder.Parent = workspace
	model.Parent = folder
	model:PivotTo(cframe)
	task.wait()
	-- stand it on the ground, measured once parented: the joints only place the parts then
	local lowest = math.huge
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") and part.Name ~= "HumanoidRootPart" then
			lowest = math.min(lowest, part.Position.Y - part.Size.Y / 2)
		end
	end
	model:PivotTo(model:GetPivot() + Vector3.new(0, (groundY or 0.5) - lowest, 0))
	return model
end

function P.dress(model: Model, dir: string)
	local cache = {}
	for _, name in PARTS do
		local part = model:FindFirstChild(name)
		if part then
			local key = dir .. "/" .. name
			local img = cache[key] or P.fetch(key)
			cache[key] = img
			part.TextureContent = Content.fromObject(img)
		end
	end
end

function P.wear(model: Model, shirtId: number?, pantsId: number?)
	for _, c in model:GetChildren() do
		if c:IsA("Shirt") or c:IsA("Pants") then
			c:Destroy()
		end
	end
	if shirtId then
		local s = Instance.new("Shirt")
		s.ShirtTemplate = "rbxassetid://" .. shirtId
		s.Parent = model
	end
	if pantsId then
		local p = Instance.new("Pants")
		p.PantsTemplate = "rbxassetid://" .. pantsId
		p.Parent = model
	end
end

function P.pose(model: Model, anim, t: number)
	local animator = model.Humanoid:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = model.Humanoid
	end
	for _, track in animator:GetPlayingAnimationTracks() do
		track:Stop(0)
	end
	local animation = anim
	if typeof(anim) == "string" then
		animation = Instance.new("Animation")
		animation.AnimationId = anim
	elseif typeof(anim) == "Instance" and anim:IsA("AnimationClip") then
		animation = Instance.new("Animation")
		animation.AnimationId = game:GetService("AnimationClipProvider"):RegisterAnimationClip(anim)
	end
	local track = animator:LoadAnimation(animation)
	track:Play(0)
	track:AdjustSpeed(0)
	track.TimePosition = t
	for _ = 1, 3 do
		animator:StepAnimations(0.001)
	end
	return track
end

function P.lineup(dirs: { string }, origin: Vector3, spacing: number?): { Model }
	local rigs = {}
	for i, dir in dirs do
		local m = P.rig(dir, CFrame.new(origin + Vector3.new((i - 1) * (spacing or 4), 5, 0)))
		P.dress(m, dir)
		table.insert(rigs, m)
	end
	return rigs
end

-- selene: allow(global_usage) -- a Studio command-bar helper: the command bar reaches it through _G
_G.ClassicPreview = P
return "ClassicPreview installed"
