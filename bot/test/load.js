const fs = require('fs');
const path = require('path');

function read(name) {
	return fs.readFileSync(path.join(__dirname, '..', 'lib', name + '.js'), 'utf8');
}

// Concatenates dependency sources before the module, the way they are inlined in a Code node.
function loadModule(name, deps = []) {
	const src = [...deps, name].map(read).join('\n');
	return new Function('module', src + '\nreturn module.exports;')({ exports: {} });
}

module.exports = { loadModule };
