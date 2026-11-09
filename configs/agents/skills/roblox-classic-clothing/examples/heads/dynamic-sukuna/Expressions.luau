-- A local facial test sequence; no animation asset upload is needed.
local E={}
E.Poses={
 {name='Grin',values={}},
 {name='Blink',values={LeftEyeClosed=1,RightEyeClosed=1}},
 {name='Left wink',values={LeftEyeClosed=1}},
 {name='Right wink',values={RightEyeClosed=1}},
 {name='Smirk',values={LeftLipCornerPuller=0.8,RightLipCornerPuller=0.3}},
 {name='Open mouth',values={JawDrop=0.65}},
}
E.Controls={'LeftEyeClosed','RightEyeClosed','LeftLipCornerPuller','RightLipCornerPuller','JawDrop'}
function E.values(index)
 local out={}
 for _,key in E.Controls do out[key]=0 end
 for key,v in E.Poses[index].values do out[key]=v end
 return out
end
function E.apply(fc,index)
 for key,v in E.values(index) do fc[key]=v end
end
return E
