bundled-sw.js: sw.js spa.js idb.js
	esbuild --bundle $< --format=iife --platform=browser --outfile=$@