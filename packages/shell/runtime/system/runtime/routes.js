const { dispatchEvent: $ } = require('logos');

async function router_runHook(req, res, ctx) {
    /**
     * @register_router runtime/dispatch-event
     * @method POST
     */

    const { event, payload } = req.body ?? { payload: {} };

    if (!event) { 
        return {
            code: 503,
            message: "The 'event' param is required."
        }
    }

    return await $(event, payload);
}

module.exports = { router_runHook };
