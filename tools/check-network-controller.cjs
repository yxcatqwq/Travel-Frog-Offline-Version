const {execFileSync} = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const apk = process.argv[2];
const source = execFileSync('tar', ['-xOf', apk, 'assets/game/js/main.min.js'], {maxBuffer: 16 * 1024 * 1024}).toString('utf8');
const start = source.indexOf('var NetworkControl=');
const end = source.indexOf('__reflect(NetworkControl.prototype', start);
assert(start >= 0 && end > start);
const context = {
  core: {Controller: function Controller() {}},
  __extends: (child, parent) => { Object.setPrototypeOf(child.prototype, parent.prototype); }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const Controller = context.NetworkControl;
assert.equal(typeof Controller.getInstance, 'function', 'Class must export its constructor, not the login function');
for (const name of ['login', 'isSyncComplete', 'setSyncComplete', 'eventsDisposeComplete', 'reloading']) {
  assert.equal(typeof Controller.prototype[name], 'function', `Missing ${name}`);
}
const instance = Object.create(Controller.prototype);
let callbacks = 0;
instance.login(() => callbacks++);
assert.equal(callbacks, 1);
assert.equal(instance.isSyncComplete(), true);
console.log('NetworkControl constructor, lifecycle methods and offline login verified.');
