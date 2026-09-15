'use strict';

const PROFESSIONAL_DEVELOPMENT_DISABLED_MESSAGE =
  'โรงเรียนนี้ยังไม่เปิดใช้งานเมนูพัฒนาวิชาชีพ';

/**
 * Feature is opt-in per deployment.  One school = one deployment, so the
 * environment is the tenant boundary; defaulting to false keeps a newly
 * provisioned school from inheriting a feature meant for another school.
 */
function professionalDevelopmentEnabled() {
  return String(process.env.PROFESSIONAL_DEVELOPMENT_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

module.exports = {
  professionalDevelopmentEnabled,
  PROFESSIONAL_DEVELOPMENT_DISABLED_MESSAGE,
};
