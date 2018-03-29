import { Router } from 'express';
import _ from 'lodash';
import moment from 'moment';
import { middlewares } from 'auth0-extension-express-tools';
import tools from 'auth0-extension-tools';

import { getUserAccessLevel, hasAccessLevel } from '../lib/middlewares';
import config from '../lib/config';
import * as constants from '../constants';

import ScriptManager from '../lib/scriptmanager';
import applications from './applications';
import connections from './connections';
import scripts from './scripts';
import me from './me';
import logs from './logs';
import users from './users';

export default (storage) => {
  const scriptManager = new ScriptManager(storage);
  const managementApiClient = middlewares.managementApiClient({
    domain: config('AUTH0_DOMAIN'),
    clientId: config('AUTH0_CLIENT_ID'),
    clientSecret: config('AUTH0_CLIENT_SECRET')
  });

  const getToken = req => _.get(req, 'headers.authorization', '').split(' ')[1];

  const addExtraUserInfo = (token, user) => {
    global.daeUser = global.daeUser || {};
    global.daeUser[user.sub] = global.daeUser[user.sub] || { exp: 0, token: '' };

    if (_.isFunction(global.daeUser[user.sub].then)) {
      return global.daeUser[user.sub];
    }

    if (global.daeUser[user.sub].exp > moment().unix() && token &&
      global.daeUser[user.sub].token === token) {
      _.assign(user, global.daeUser[user.sub]);
      return Promise.resolve(user);
    }

    if (!token) console.error('no token found');

    const promise = tools.managementApi.getClient({
      domain: config('AUTH0_DOMAIN'),
      clientId: config('AUTH0_CLIENT_ID'),
      clientSecret: config('AUTH0_CLIENT_SECRET')
    })
      .then(auth0 =>
        auth0.users.get({ id: user.sub })
          .then((userData) => {
            _.assign(user, userData);
            user.token = token;
            global.daeUser[user.sub] = user;
            return user;
          })
      );

    global.daeUser[user.sub] = promise;

    return global.daeUser[user.sub];
  };

  const api = Router();

  api.use(middlewares.authenticateUsers.optional({
    domain: config('AUTH0_DOMAIN'),
    audience: config('EXTENSION_CLIENT_ID'),
    credentialsRequired: false,
    onLoginSuccess: (req, res, next) => {
      const currentRequest = req;
      return addExtraUserInfo(getToken(req), req.user)
        .then((user) => {
          currentRequest.user = user;
          return next();
        })
        .catch(next);
    }
  }));
  api.use(getUserAccessLevel);
  api.use(hasAccessLevel(constants.USER_ACCESS_LEVEL));
  api.use('/applications', managementApiClient, applications());
  api.use('/connections', managementApiClient, connections(scriptManager));
  api.use('/scripts', hasAccessLevel(constants.ADMIN_ACCESS_LEVEL), scripts(storage, scriptManager));
  api.use('/users', managementApiClient, users(storage, scriptManager));
  api.use('/logs', managementApiClient, logs(scriptManager));
  api.use('/me', me(scriptManager));
  api.get('/settings', (req, res, next) => {
    const settingsContext = {
      request: {
        user: req.user
      }
    };

    scriptManager.execute('settings', settingsContext)
      .then(settings => res.json({ settings: settings || {} }))
      .catch(next);
  });

  return api;
};
