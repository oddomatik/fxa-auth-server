/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var restify = require('restify')
var safeJsonFormatter = require('restify-safe-json-formatter')
var config = require('../config')

var log = require('../lib/senders/log')('server')
var mailConfig = config.get('smtp')
var mailerServerConfig = config.get('mailerServer')

var packageJson = require('../package.json')
var P = require('bluebird')

// NOTE: Mailer is also used by fxa-auth-server directly with an old logging interface
// the legacy log module provides an interface to convert old logs to new mozlog logging.
var mailerLog = require('../lib/senders/log')('mailer')
var legacyMailerLog = require('../lib/senders/legacy_log')(mailerLog)
var Mailer = require('../lib/senders/email')(legacyMailerLog)

var dbConnect = require('../lib/senders/db_connect')()

P.all(
  [
    require('../lib/senders/translator')(config.get('i18n.supportedLanguages'), config.get('i18n.defaultLanguage')),
    require('../lib/senders/templates').init()
  ]
)
.spread(
  function (translator, templates) {
    var mailer = new Mailer(translator, templates, mailConfig)
    log.info('config', config.getProperties())
    log.info('mailConfig', mailConfig)
    log.info('mailerServerConfig', mailerServerConfig)
    log.info('templates', Object.keys(templates))

    dbConnect()
      .then(function (db) {
        // fetch and process verification reminders
        var verificationReminders = require('../lib/senders/verification-reminders')(mailer, db)
        verificationReminders.poll()
      })
      .catch(function (err) {
        log.error('server', {err: err})
      })

    var api = restify.createServer({
      formatters: {
        'application/json; q=0.9': safeJsonFormatter
      }
    })
    api.use(restify.bodyParser())
    /*/
    {
      type:
      email:
      uid:
      code:
      token:
      service:
      redirectTo:
      acceptLanguage:
    }
    /*/
    api.post(
      '/send',
      function (req, res, next) {
        var type = req.body.type
        if (typeof(mailer[type]) === 'function') {
          mailer[type](req.body)
          res.send(200)
        }
        else {
          log.error('send', { err: { message: 'invalid type', body: req.body }})
          res.send(400)
        }
        next()
      }
    )

    api.get(
      '/',
      function (req, res, next) {
        res.send({ version: packageJson.version })
        next()
      }
    )

    api.listen(
      mailerServerConfig.port,
      mailerServerConfig.host,
      function () {
        log.info('listening', { port: mailerServerConfig.port, host: mailerServerConfig.host })
      }
    )
  }
)
.catch(
  function (err) {
    log.error('init', err)
    process.exit(8)
  }
)
