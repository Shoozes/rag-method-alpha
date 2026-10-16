// Frozen before the repair: body pixels, never text, a maximum pixel, or a color-derived ROI.
export const NODE_COLOR_THRESHOLDS=Object.freeze({region:'body disk',radiusFraction:.8,minimumSamples:12,minimumColoredFraction:.65,minimumSaturation:.35,minimumValue:.20,minimumMeanSaturation:.35,minimumPairChromaticityDistance:.20,hues:{conversation:[185,220],persona:[255,300],global:[30,55]}});

// Self-contained for Playwright serialization. Tests may supply raw RGBA; browser proofs
// supply a screenshot PNG, decoded without transforms or filters in an ephemeral canvas.
export async function measureNodeColorArea({data,rgba,width,height,samples,thresholds,viewport}){
  if(data){
    const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d');context.drawImage(image,0,0);
    width=image.width;height=image.height;rgba=context.getImageData(0,0,width,height).data;
  }
  const ratioX=width/viewport.width,ratioY=height/viewport.height;
  if(Math.abs(ratioX-ratioY)>.001)throw Error('Screenshot pixel scale must be uniform.');
  const hsv=([r,g,b])=>{
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    let h=delta===0?0:max===r?60*((g-b)/delta%6):max===g?60*((b-r)/delta+2):60*((r-g)/delta+4);
    if(h<0)h+=360;return{h,s:max?delta/max:0,v:max};
  };
  return samples.map(sample=>{
    const x=sample.x*ratioX,y=sample.y*ratioY,r=sample.radius*thresholds.radiusFraction*ratioX;
    const values=[],sum=[0,0,0];let colored=0;
    for(let py=Math.floor(y-r);py<=Math.ceil(y+r);py++)for(let px=Math.floor(x-r);px<=Math.ceil(x+r);px++){
      if((px+.5-x)**2+(py+.5-y)**2>r*r)continue;
      if(px<0||py<0||px>=width||py>=height)throw Error('Body region must be fully inside screenshot.');
      const offset=(py*width+px)*4,rgb=[rgba[offset],rgba[offset+1],rgba[offset+2]],value=hsv(rgb);
      values.push(value);rgb.forEach((n,index)=>sum[index]+=n);
      const[h0,h1]=thresholds.hues[sample.scope];
      if(value.s>=thresholds.minimumSaturation&&value.v>=thresholds.minimumValue&&value.h>=h0&&value.h<=h1)colored++;
    }
    const n=values.length,meanRgb=sum.map(value=>value/n),total=meanRgb.reduce((a,b)=>a+b,0);
    return{...sample,samples:n,coloredFraction:colored/n,meanSaturation:values.reduce((sum,value)=>sum+value.s,0)/n,meanRgb,chromaticity:meanRgb.map(value=>value/total)};
  });
}

export function assessNodeColorArea(samples,{thresholds=NODE_COLOR_THRESHOLDS,requiredScopes=Object.keys(thresholds.hues)}={}){
  const failures=[];
  for(const scope of requiredScopes)if(!samples.some(sample=>sample.scope===scope))failures.push('No actual body sample for '+scope);
  for(const sample of samples){
    if(sample.samples<thresholds.minimumSamples)failures.push(sample.id+': too few body samples');
    if(!Number.isFinite(sample.coloredFraction)||sample.coloredFraction<thresholds.minimumColoredFraction)failures.push(sample.id+': intended-hue area '+sample.coloredFraction.toFixed(3));
    if(!Number.isFinite(sample.meanSaturation)||sample.meanSaturation<thresholds.minimumMeanSaturation)failures.push(sample.id+': mean saturation '+sample.meanSaturation.toFixed(3));
  }
  const scopeMeans=Object.keys(thresholds.hues).filter(scope=>samples.some(sample=>sample.scope===scope)).map(scope=>{
    const rows=samples.filter(value=>value.scope===scope);
    return{scope,chromaticity:[0,1,2].map(index=>rows.reduce((sum,row)=>sum+row.chromaticity[index],0)/rows.length)};
  }),pairs=[];
  for(let a=0;a<scopeMeans.length;a++)for(let b=a+1;b<scopeMeans.length;b++){
    const distance=Math.hypot(...scopeMeans[a].chromaticity.map((value,index)=>value-scopeMeans[b].chromaticity[index]));
    pairs.push({left:scopeMeans[a].scope,right:scopeMeans[b].scope,distance});
    if(!Number.isFinite(distance)||distance<thresholds.minimumPairChromaticityDistance)failures.push(scopeMeans[a].scope+'/'+scopeMeans[b].scope+': chromaticity distance '+distance.toFixed(3));
  }
  return{passed:failures.length===0,failures,samples,pairs};
}
