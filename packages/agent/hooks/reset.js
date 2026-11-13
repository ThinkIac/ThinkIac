let isScheduled = false;

function isScheduledReset() {
    /**
     * @register_hook is-scheduled-reset
     */

    return isScheduled;
}

function scheduleReset() {
    /**
     * @register_hook schedule-reset
     */

    
    isScheduled = true;
}

function clearScheduledReset() {
    /**
     * @register_hook clear-scheduled-reset
     */

    isScheduled = false;
}