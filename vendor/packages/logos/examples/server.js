// examples/server.js — run the example packages.
//
//   cd examples && node server.js
//
// Then open:
//   http://localhost:5040/                 → hello/Home (Svelte + Bootstrap)
//   http://localhost:5040/hello/ping       → JSON route
//   http://localhost:5040/view/hello/Home  → the page directly
//
// The py-echo module is bridged over stdio; from any package you could call
//   const { $ } = require('logos'); await $('python:upper', { text: 'hi' })

const path = require('path');
const { bootstrap } = require('..'); // in a real project: require('logos')

bootstrap({
  workspace: path.join(__dirname),        // examples/ acts as the packages root
  port: 5040,
  views: {
    bootstrap5: true,
    theme: { 'bs-primary': '#6d28d9' },
    index: { package: 'hello', page: 'Home' },
  },
}).then(() => {
  console.log('Example runtime is up. Try http://localhost:5040/hello/ping');
});
