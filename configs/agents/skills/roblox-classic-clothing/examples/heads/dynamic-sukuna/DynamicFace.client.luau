-- Uses the same packed artwork as the static face without replacing the facial rig.
local H = require(game:GetService('ReplicatedStorage'):WaitForChild('HeadLab'))
local images = {}
local watched = {}

local function apply(part)
	local face = part:GetAttribute('DynamicFaceTexture')
	if not face then return end
	local skin = part:GetAttribute('DynamicFaceSkin') or Color3.fromRGB(244, 210, 181)
	local key = face .. ':' .. tostring(skin)
	local image = images[key]
	if not image then
		image = H.face(face, skin)
		images[key] = image
	end
	local content = part.TextureContent
	if content.SourceType ~= Enum.ContentSourceType.Object or content.Object ~= image then
		part.TextureContent = Content.fromObject(image)
	end
	part.Color = Color3.new(1, 1, 1)
end

local function watch(part)
	if not part:IsA('MeshPart') or watched[part] then return end
	watched[part] = true
	part:GetAttributeChangedSignal('DynamicFaceTexture'):Connect(function() apply(part) end)
	part:GetAttributeChangedSignal('DynamicFaceSkin'):Connect(function() apply(part) end)
	part:GetPropertyChangedSignal('TextureContent'):Connect(function() apply(part) end)
	apply(part)
end

for _,part in workspace:GetDescendants() do watch(part) end
workspace.DescendantAdded:Connect(function(part) task.defer(watch, part) end)
