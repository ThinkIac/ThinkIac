const { onAgentStart, onToolEnd, onToolsSelect, onAgentFinally, onClassifiedGet, onFullContextRequest } = require('./hook');
const {
    listModels,
    selectModel,
    setApproximationLevel,
    getApproximationLevel,
    resetApproximationLevel,
    listApproximationModes
} = require('./tools');
const protocol = require('./protocol');

module.exports = {
    onAgentStart,
    onToolEnd,
    onToolsSelect,
    onAgentFinally,
    onClassifiedGet,
    onFullContextRequest,
    listModels,
    selectModel,
    setApproximationLevel,
    getApproximationLevel,
    resetApproximationLevel,
    listApproximationModes,
    ...protocol
};
