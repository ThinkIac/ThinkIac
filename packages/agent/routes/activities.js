import { listActivities } from '../core/activity_registry.js'

export function activitiesList(req) {
  /**
   * @register_router activities
   * @method GET
   */
  const sessionId = req.query?.sessionId
  if (!sessionId) return { status: 400, data: { error: 'sessionId is required' } }
  return { data: listActivities(sessionId) }
}
