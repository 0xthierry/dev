--!nocheck
-- NPC heads in Studio, without uploading: our face on our NPC head (Roblox's default head without its eyes), our own
-- mesh pieces (beard, bun...) and catalog hair or face accessories. Built in edit mode; in Play, HeadLabClient rebuilds them on each client. In the
-- HeadsLab place (heads-lab.project.json) it is the ModuleScript ReplicatedStorage.HeadLab:
-- `local H = require(game.ReplicatedStorage.HeadLab)`; ReplicatedStorage.HeadLabData holds what pack.py wrote.
-- It also sets _G.HeadLab:
--   H.face(name, skin?)                    EditableImage from HeadLabData.<name> (a packed face), baked over skin
--   H.npcHead(head, face)                  the head becomes our NPC head (Roblox's head without its eyes), face on it
--   H.meshAccessory(model, name, tex?)     an Accessory from HeadLabData.pieces[name], on its attachment; textured with
--                                          tex (default: H.strands in the piece's colour; false: plain colour for metal
--                                          or cloth), UVs by a flat front projection
--   H.strands(colour, size?)               a hair-strand texture made in code (plain colour reads as plastic)
--   H.npc(name, cframe, opts)              an R15 rig: opts.skin, opts.hair / opts.faceAccessory / opts.hat (catalog
--                                          ids, comma separated), opts.shirt / opts.pants (image ids), opts.face (a packed
--                                          face name), opts.pieces (names in pieces), opts.pieceTexture (false: plain colours)
--   H.search(keyword, assetType?, limit?)  catalog search: { {id, name, creator} } (assetType: Enum.AvatarAssetType)
--   H.rebuild(part)                        in Play: an NPC head or piece that came up empty, rebuilt from its attributes
local AssetService = game:GetService("AssetService")
local Players = game:GetService("Players")
local AvatarEditorService = game:GetService("AvatarEditorService")

local H = {}
local function data()
	return game:GetService("ReplicatedStorage"):WaitForChild("HeadLabData")
end

function H.face(name: string, skin: Color3?): EditableImage
	local s = data()[name].Value
	local w, h, body = string.match(s, "^(%d+),(%d+);(.*)$")
	w, h = tonumber(w), tonumber(h)
	local sr, sg, sb = 0, 0, 0
	if skin then
		sr, sg, sb = skin.R * 255, skin.G * 255, skin.B * 255
	end
	local buf = buffer.create(w * h * 4)
	local o = 0
	for i = 1, #body, 12 do
		local n = tonumber(string.sub(body, i, i + 3), 16)
		local r = tonumber(string.sub(body, i + 4, i + 5), 16)
		local g = tonumber(string.sub(body, i + 6, i + 7), 16)
		local b = tonumber(string.sub(body, i + 8, i + 9), 16)
		local a = tonumber(string.sub(body, i + 10, i + 11), 16)
		if skin then -- a MeshPart texture set this way shows black, not the part's Color, where it is transparent
			local t = a / 255
			r, g, b, a =
				math.floor(r * t + sr * (1 - t) + 0.5),
				math.floor(g * t + sg * (1 - t) + 0.5),
				math.floor(b * t + sb * (1 - t) + 0.5),
				255
		end
		for _ = 1, n do
			buffer.writeu8(buf, o, r)
			buffer.writeu8(buf, o + 1, g)
			buffer.writeu8(buf, o + 2, b)
			buffer.writeu8(buf, o + 3, a)
			o += 4
		end
	end
	local img = AssetService:CreateEditableImage({ Size = Vector2.new(w, h) })
	img:WritePixelsBuffer(Vector2.zero, Vector2.new(w, h), buf)
	return img
end

function H.strands(colour: Color3, size: number?): EditableImage
	size = size or 256
	local img = AssetService:CreateEditableImage({ Size = Vector2.new(size, size) })
	local buf = buffer.create(size * size * 4)
	local rng = Random.new(7)
	local col = {}
	for x = 0, size - 1 do
		col[x] = { b = 0.80 + 0.20 * rng:NextNumber(), ph = rng:NextNumber() * 2 * math.pi }
	end
	for y = 0, size - 1 do
		for x = 0, size - 1 do
			local xs = (x + math.sin(y / size * 4 * math.pi + col[x].ph) * 1.5) % size -- a little wave
			local lock = 0.5 + 0.5 * math.cos(xs / size * 18 * math.pi) -- locks, darker between them
			local root = 0.82 + 0.18 * math.min(1, y / (size * 0.35)) -- darker at the roots (top)
			local v = (0.78 + 0.22 * lock ^ 0.6) * col[math.floor(xs)].b * root
			local o = (y * size + x) * 4
			buffer.writeu8(buf, o, math.clamp(colour.R * 255 * v, 0, 255))
			buffer.writeu8(buf, o + 1, math.clamp(colour.G * 255 * v, 0, 255))
			buffer.writeu8(buf, o + 2, math.clamp(colour.B * 255 * v, 0, 255))
			buffer.writeu8(buf, o + 3, 255)
		end
	end
	img:WritePixelsBuffer(Vector2.zero, Vector2.new(size, size), buf)
	return img
end

local B64 = {}
for i, c in string.split("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", "") do
	B64[string.byte(c)] = i - 1
end

-- A piece's own texture: HeadLabData.<name>_tex holds "W,H;" then base64 RGBA (pack.py)
function H.texture(name: string): EditableImage
	local s = data()[name .. "_tex"].Value
	local w, h, body = string.match(s, "^(%d+),(%d+);(.*)$")
	w, h = tonumber(w), tonumber(h)
	local buf = buffer.create(w * h * 4)
	local o, n = 0, w * h * 4
	for i = 1, #body, 4 do
		local a, b, c, d = string.byte(body, i, i + 3)
		local v = bit32.bor(
			bit32.lshift(B64[a] or 0, 18),
			bit32.lshift(B64[b] or 0, 12),
			bit32.lshift(B64[c] or 0, 6),
			B64[d] or 0
		)
		for k = 2, 0, -1 do
			if o < n then
				buffer.writeu8(buf, o, bit32.band(bit32.rshift(v, k * 8), 255))
				o += 1
			end
		end
	end
	local img = AssetService:CreateEditableImage({ Size = Vector2.new(w, h) })
	img:WritePixelsBuffer(Vector2.zero, Vector2.new(w, h), buf)
	return img
end

-- a piece by name, from any pieces module in HeadLabData
local function findPiece(name: string)
	for _, m in data():GetChildren() do
		if m:IsA("ModuleScript") then
			local p = require(m)[name]
			if p then
				return p
			end
		end
	end
	error("no piece " .. name)
end

-- Our NPC head (npc_head.py): Roblox's default head without its eyes, packed as the piece "NpcHead" (per-corner
-- vertices, normals and UVs in head space, the head's size). Its front takes the face image by a flat projection.
local function npcHeadMesh(): MeshPart
	local p = findPiece("NpcHead")
	local v, n, uv = p.v, p.n, p.uv
	local em = AssetService:CreateEditableMesh()
	local vid, nid, uid = {}, {}, {}
	for i = 1, #v, 3 do
		local k = #vid + 1
		vid[k] = em:AddVertex(Vector3.new(v[i], v[i + 1], v[i + 2]))
		nid[k] = em:AddNormal(Vector3.new(n[i], n[i + 1], n[i + 2]))
		uid[k] = em:AddUV(Vector2.new(uv[2 * k - 1], uv[2 * k]))
	end
	for i = 1, #vid, 3 do
		local f = em:AddTriangle(vid[i], vid[i + 1], vid[i + 2])
		em:SetFaceNormals(f, { nid[i], nid[i + 1], nid[i + 2] })
		em:SetFaceUVs(f, { uid[i], uid[i + 1], uid[i + 2] })
	end
	return AssetService:CreateMeshPartAsync(Content.fromObject(em))
end

function H.npcHead(head: MeshPart, face: EditableImage)
	local tmp = npcHeadMesh()
	head:ApplyMesh(tmp) -- keeps the head's joints, attachments and size
	tmp:Destroy()
	head.TextureContent = Content.fromObject(face)
end

-- the head's scale: the Humanoid scales accessories by Size / OriginalSize (under 1 with BodyTypeScale), so pieces are
-- authored for the unscaled head and come out fitting the head as it is
local function headScale(model: Model): Vector3
	local orig = model.Head:FindFirstChild("OriginalSize")
	return if orig then model.Head.Size / orig.Value else Vector3.one
end

-- a piece's mesh as a new MeshPart centred on the piece's bounds (vertices are in head space), and that centre
local function pieceMesh(p, s: Vector3): (MeshPart, Vector3)
	local v, n, t = p.v, p.n, p.t
	local lo, hi = Vector3.one * math.huge, -Vector3.one * math.huge
	for i = 1, #v, 3 do
		local q = Vector3.new(v[i], v[i + 1], v[i + 2])
		lo, hi = lo:Min(q), hi:Max(q)
	end
	local centre, span = (lo + hi) / 2, hi - lo
	local em = AssetService:CreateEditableMesh()
	local vid, nid, uid = {}, {}, {}
	for i = 1, #v, 3 do
		local q = Vector3.new(v[i], v[i + 1], v[i + 2])
		vid[#vid + 1] = em:AddVertex((q - centre) / s)
		nid[#nid + 1] = em:AddNormal(Vector3.new(n[i], n[i + 1], n[i + 2]))
		local k = #vid
		if p.uv then -- the piece's own UVs (a generated model)
			uid[k] = em:AddUV(Vector2.new(p.uv[2 * k - 1], p.uv[2 * k]))
		else -- a flat front projection: the texture's rows run down the piece, so strands hang
			uid[k] = em:AddUV(Vector2.new((q.X - lo.X) / math.max(span.X, 1e-3), (hi.Y - q.Y) / math.max(span.Y, 1e-3)))
		end
	end
	for i = 1, #t, 3 do
		local a, b, c = t[i] + 1, t[i + 1] + 1, t[i + 2] + 1
		local f = em:AddTriangle(vid[a], vid[b], vid[c])
		em:SetFaceNormals(f, { nid[a], nid[b], nid[c] })
		em:SetFaceUVs(f, { uid[a], uid[b], uid[c] })
	end
	return AssetService:CreateMeshPartAsync(Content.fromObject(em)), centre
end

-- texture kinds: "own" (the piece's packed texture), "strands" (H.strands in its colour), "plain" (its colour only)
local function pieceTexture(part: MeshPart, name: string, p, kind: string, tex: EditableImage?)
	if kind == "own" then
		part.TextureContent = Content.fromObject(H.texture(name))
	elseif kind == "strands" then
		part.TextureContent = Content.fromObject(tex or H.strands(Color3.fromRGB(p.color[1], p.color[2], p.color[3])))
	end
end

function H.meshAccessory(model: Model, name: string, tex: (EditableImage | boolean)?): Accessory
	local p = findPiece(name)
	local s = headScale(model)
	local mp, centre = pieceMesh(p, s)
	mp.Name = "Handle"
	local kind = if p.textured then "own" elseif tex == false then "plain" else "strands"
	if kind == "plain" then -- metal, cloth
		mp.Color = Color3.fromRGB(p.color[1], p.color[2], p.color[3])
	end
	pieceTexture(mp, name, p, kind, if typeof(tex) == "EditableImage" then tex else nil)
	mp:SetAttribute("HeadLabPiece", name) -- for H.rebuild in Play
	mp:SetAttribute("HeadLabTexture", kind)
	-- an outline (an inverted hull) draws unlit: Neon in a dark colour has no shading, where SmoothPlastic put white
	-- specular glints along the hull's folds
	mp.Material = if p.plain then Enum.Material.Neon else Enum.Material.SmoothPlastic
	mp.CanCollide, mp.CanQuery, mp.CanTouch, mp.Massless = false, false, false, true
	local att = Instance.new("Attachment")
	att.Name = p.attachment
	att.Position = (model.Head[p.attachment].Position - centre) / s
	att.Parent = mp
	local acc = Instance.new("Accessory")
	acc.Name = name
	mp.Parent = acc
	model.Humanoid:AddAccessory(acc)
	return acc
end

-- Heads and pieces built in edit mode come up empty in Play: an EditableMesh or EditableImage lives only in the
-- session that made it, so Play's copy of the place has pieces as plain boxes and heads without our face. This rebuilds one from the attributes
-- H.npc and H.meshAccessory left on it (HeadLabClient calls it on every client).
function H.rebuild(part: MeshPart)
	local face, piece = part:GetAttribute("HeadLabFace"), part:GetAttribute("HeadLabPiece")
	local ours = Enum.ContentSourceType.Object
	if face and (part.MeshContent.SourceType ~= ours or part.TextureContent.SourceType ~= ours) then
		H.npcHead(part, H.face(face, part:GetAttribute("HeadLabSkin")))
	elseif piece and part.MeshContent.SourceType == Enum.ContentSourceType.None then
		local p = findPiece(piece)
		local tmp = pieceMesh(p, headScale(part:FindFirstAncestorOfClass("Model")))
		part:ApplyMesh(tmp) -- keeps the part's size, which the Humanoid already scaled
		tmp:Destroy()
		pieceTexture(part, piece, p, part:GetAttribute("HeadLabTexture"))
	end
end

function H.npc(name: string, cframe: CFrame, opts)
	opts = opts or {}
	local d = Instance.new("HumanoidDescription")
	local c = opts.skin or Color3.fromRGB(234, 184, 146)
	d.HeadColor, d.TorsoColor, d.LeftArmColor, d.RightArmColor, d.LeftLegColor, d.RightLegColor = c, c, c, c, c, c
	d.HairAccessory = opts.hair or ""
	d.FaceAccessory = opts.faceAccessory or ""
	d.HatAccessory = opts.hat or ""
	local m = Players:CreateHumanoidModelFromDescriptionAsync(d, Enum.HumanoidRigType.R15)
	m.Name = name
	m.HumanoidRootPart.Anchored = true
	local folder = workspace:FindFirstChild("HeadLab") or Instance.new("Folder")
	folder.Name = "HeadLab"
	folder.Parent = workspace
	m.Parent = folder
	if opts.shirt then
		local s = Instance.new("Shirt")
		s.ShirtTemplate = "rbxassetid://" .. opts.shirt
		s.Parent = m
	end
	if opts.pants then
		local p = Instance.new("Pants")
		p.PantsTemplate = "rbxassetid://" .. opts.pants
		p.Parent = m
	end
	if opts.face then
		H.npcHead(m.Head, H.face(opts.face, c))
		m.Head:SetAttribute("HeadLabFace", opts.face) -- for H.rebuild in Play
		m.Head:SetAttribute("HeadLabSkin", c)
	end
	for _, piece in opts.pieces or {} do
		H.meshAccessory(m, piece, opts.pieceTexture)
	end
	m:PivotTo(cframe)
	task.wait()
	local lowest = math.huge -- stand it on the ground (y = 0)
	for _, part in m:GetDescendants() do
		if
			part:IsA("BasePart")
			and part.Name ~= "HumanoidRootPart"
			and not part:FindFirstAncestorWhichIsA("Accessory")
		then
			lowest = math.min(lowest, part.Position.Y - part.Size.Y / 2)
		end
	end
	m:PivotTo(m:GetPivot() + Vector3.new(0, -lowest, 0))
	return m
end

function H.search(keyword: string, assetType, limit: number?)
	local params = CatalogSearchParams.new()
	params.SearchKeyword = keyword
	params.AssetTypes = { assetType or Enum.AvatarAssetType.HairAccessory }
	-- the catalog only takes certain page sizes (5 fails with HTTP 400): ask for the next one up, keep `limit`
	limit = limit or 10
	for _, size in { 10, 28, 30, 60, 120 } do
		params.Limit = size
		if size >= limit then
			break
		end
	end
	local out = {}
	for _, item in AvatarEditorService:SearchCatalog(params):GetCurrentPage() do
		if #out < limit then
			table.insert(out, { id = item.Id, name = item.Name, creator = item.CreatorName })
		end
	end
	return out
end

-- selene: allow(global_usage) -- a Studio command-bar helper: the command bar reaches it through _G
_G.HeadLab = H
return H -- a ModuleScript in the HeadsLab place (require it), or the command bar's result
