'use strict';

// This deployment-local switch is set by the privileged ops worker. It is never
// inferred from the seller's sales stage or from missing usage statistics.
function archiveState(env = process.env) {
  return {
    readonly: env.PSSMS_SERVICE_READONLY === '1',
    freezeId: env.PSSMS_SERVICE_READONLY === '1' ? String(env.PSSMS_ARCHIVE_FREEZE_ID || '') : '',
    closeAfter: /^\d{4}-\d{2}-\d{2}$/.test(env.PSSMS_SERVICE_CLOSE_AFTER || '') ? env.PSSMS_SERVICE_CLOSE_AFTER : null,
    noticeOn: /^\d{4}-\d{2}-\d{2}$/.test(env.PSSMS_SERVICE_NOTICE_ON || '') ? env.PSSMS_SERVICE_NOTICE_ON : null,
  };
}

module.exports = { archiveState };
