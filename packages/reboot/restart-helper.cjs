'use strict'

const { request } = require('@thinkiac/module-supervisor/index.cjs')

const [, , supervisorRoot, service, rawDelay = '0'] = process.argv
const delay = Number(rawDelay)

if (!supervisorRoot || !service || !Number.isFinite(delay) || delay < 0 || delay > 60_000) {
  process.exitCode = 2
} else {
  setTimeout(() => {
    request(supervisorRoot, 'restart', service)
      .then(() => process.exit(0))
      .catch(error => {
        console.error('[REBOOT] supervisor restart rejected:', error.message)
        process.exit(1)
      })
  }, delay)
}
