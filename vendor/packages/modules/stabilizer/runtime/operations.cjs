// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageOperation = packageOperation;
/** One lifecycle operation per package. Nested staging runs inside its caller's lock. */
function packageOperation(container, folder, operation) {
    const locks = container.state('packageOperations');
    const previous = locks.get(folder) ?? Promise.resolve();
    const next = previous.catch(() => { }).then(operation);
    locks.set(folder, next);
    void next.finally(() => { if (locks.get(folder) === next)
        locks.delete(folder); }).catch(() => { });
    return next;
}

};
