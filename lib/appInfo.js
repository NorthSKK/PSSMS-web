'use strict';

const { buildId } = require('./buildId');
const pkg = require('../package.json');

// This value is intentionally small and public: it is used by the customer
// registry to tell which build a deployment is running. Never add settings,
// school details, environment variables, or git URLs here.
const bootedAt = new Date().toISOString();

function deployedAt() {
  const raw = process.env.RAILWAY_DEPLOYED_AT
    || process.env.RAILWAY_DEPLOYMENT_CREATED_AT
    || process.env.SOURCE_DATE_EPOCH;
  if (!raw) return bootedAt;
  const value = /^\d+$/.test(String(raw))
    ? new Date(Number(raw) * 1000)
    : new Date(raw);
  return Number.isNaN(value.getTime()) ? bootedAt : value.toISOString();
}

function appInfo() {
  return {
    version: String(pkg.version || '0.0.0'),
    build: buildId(),
    deployedAt: deployedAt(),
  };
}

module.exports = { appInfo };
