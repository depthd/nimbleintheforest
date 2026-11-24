// Produce the review build with the original conifer embedded for offline use.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const scene=resolve(root,'experiments/plateau');
const output=resolve(process.argv[2] ?? resolve(root,'dist/plateau-range.html'));
const model=await readFile(resolve(root,'public/models/conifer_c1.glb'));
const bundle=await build({
  entryPoints:[resolve(scene,'mountain.ts')],bundle:true,platform:'browser',
  format:'iife',minify:true,write:false,
  plugins:[{
    name:'offline-conifer',
    setup(api){
      api.onLoad({filter:/mountain-groves\.ts$/},async({path})=>({
        contents:(await readFile(path,'utf8')).replace(
          "new URL('../../models/conifer_c1.glb', document.baseURI).href",
          JSON.stringify('data:model/gltf-binary;base64,'+model.toString('base64'))),
        loader:'ts'
      }));
    }
  }]
});
const html=await readFile(resolve(scene,'mountain.html'),'utf8');
const js=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,html.replace('<script type="module" src="./mountain.ts"></script>',()=>'<script>'+js+'</script>'));
