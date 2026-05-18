/**
 * gas-shim.js
 * Replaces google.script.run with fetch-based calls to /api/gas/:fnName
 * Drop-in: existing Scripts_*.html code works unchanged.
 */
(function () {
  'use strict';

  const API_BASE = '/api/gas';

  function _getToken() {
    return localStorage.getItem('pssms_jwt') || '';
  }

  function _callApi(fnName, args, onSuccess, onFailure) {
    const token = _getToken();
    fetch(API_BASE + '/' + fnName, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      body: JSON.stringify({ args: Array.prototype.slice.call(args) }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Persist JWT issued on successful login
        if (data.__jwt) localStorage.setItem('pssms_jwt', data.__jwt);
        if (data.__error) {
          onFailure(new Error(data.__error));
        } else {
          onSuccess(data.__result);
        }
      })
      .catch(function (err) { onFailure(err); });
  }

  function _makeChain(s, f) {
    return new Proxy(
      {
        withSuccessHandler: function (fn) { return _makeChain(fn, f); },
        withFailureHandler: function (fn) { return _makeChain(s, fn); },
      },
      {
        get: function (target, prop) {
          if (prop in target) return target[prop];
          return function () {
            _callApi(
              prop,
              arguments,
              s || function () {},
              f || function (e) { console.error('[GAS shim]', prop, e && e.message || e); }
            );
          };
        },
      }
    );
  }

  window.google = {
    script: {
      run: _makeChain(null, null),
      history: { push: function () {} },
      url: { getLocation: function (cb) { if (cb) cb({ parameter: {}, hash: '' }); } },
    },
  };

})();
