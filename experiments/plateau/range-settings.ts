export const sceneChoices = {
  count: ['1','2','3','4'],
  layers: ['auto','1','2','3','4'],
  shape: ['original','long','broad','mixed'],
  height: ['original','low','high','mixed'],
  relief: ['flat','hills','valley'],
} as const;
export type RangeSettings = { [K in keyof typeof sceneChoices]: typeof sceneChoices[K][number] };
export const originalRange:RangeSettings = {count:'2', layers:'auto', shape:'original', height:'original', relief:'flat'};
export function readRangeSettings(params:URLSearchParams):RangeSettings {
  const settings={...originalRange};
  function read<K extends keyof RangeSettings>(key:K){
    const value=params.get(key);
    if(value && (sceneChoices[key] as readonly string[]).includes(value)) settings[key]=value as RangeSettings[K];
  }
  for(const key of Object.keys(settings) as (keyof RangeSettings)[]) read(key);
  return settings;
}
