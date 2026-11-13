// examples/hello/tools.js

/**
 * @register_tool add
 * @description Adds two numbers.
 * @param {number} a - First addend
 * @param {number} b - Second addend
 */
async function add({ a, b }) {
  return { sum: Number(a) + Number(b) };
}

module.exports = { add };
