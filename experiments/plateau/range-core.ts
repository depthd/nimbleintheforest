import { reliefGrid } from './seam-relief-fixture';
import { buildWedgeAscent } from './wedge-ascent';
import { bluntTip } from './wedge-tip-profile';
import { mountainEnding, plateauTop } from './mountain-shape';
import { selectOutline } from './plateau-profile';

export function generateRockCore(){
  for(let attempt=0;;attempt++){
    selectOutline(attempt);
    const source=reliefGrid(plateauTop);
    const upper={...source,heights:source.heights.map((_,k)=>
      plateauTop(source.x0+k%(source.n+1)*source.cell, source.z0+Math.floor(k/(source.n+1))*source.cell))};
    try {
      const junction=buildWedgeAscent(source,upper,mountainEnding,bluntTip);
      return {source,upper,junction,attempt};
    } catch(error){
      // A contour tangent to a grid corner can degenerate after Float32
      // rounding. Resample this outline only; preserve the layout and route.
      const degenerate=error instanceof Error && /contour|Swept nose|Tip dimensions|Tip profile/.test(error.message);
      if(!degenerate||attempt>=4)throw error;
    }
  }
}
