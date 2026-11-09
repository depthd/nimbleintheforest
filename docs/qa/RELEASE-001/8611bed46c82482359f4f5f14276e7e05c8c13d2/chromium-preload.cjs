const {chromium}=require('playwright');
const launch=chromium.launch.bind(chromium);
chromium.launch=opts=>launch({...opts,executablePath:'/usr/bin/chromium'});
