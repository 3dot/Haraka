'use strict';
// rcpt_to.all - accept all email, and perform checks if recipient is valid

var logger = require('./logger');
var redis = require('redis');
var async = require('async');
var lodash = require('lodash');
var client;

exports.register = function() {
    this.init_redis_cebox();
	this.register_hook('rcpt', 'rcpt_to_set');
    this.register_hook('rcpt', 'rcpt_to_all');
};

exports.init_redis_cebox = function() {
    var plugin = this;
    // this is called during init of redis-cebox

    //Read the config file redis-cebox
    var config = plugin.config.get('redis-cebox.ini');
    var options = {};

    //Getting the values from config file redis-cebox.ini
    if (config.rediscebox) {
        options['host'] = config.rediscebox.server_ip || '127.0.0.1';
        options['port'] = config.rediscebox.server_port || '5672';
        options['db'] = config.rediscebox.server_db || '0';
    }
    else {
        //If config file is not available , lets get the default values
        options['host'] = '127.0.0.1';
        options['port'] = '5672';
        options['db'] = '0';
    }

    logger.logdebug("Connecting to Redis " + options['host'] + ":" + options['port'] + "/" + options['db'] + "/");

    client = redis.createClient(options['port'], options['host'], {});
    client.select(options['db'], function() {});
}

exports.rcpt_to_set = function(next, connection, params) {
    var plugin = this;

    var success = function(rcpt) {
        logger.logdebug("RCPT: " + rcpt);
        connection.transaction.results.add(plugin, {pass: 'accepted'});
        connection.transaction.notes.destination = rcpt;
        return next();
    };

    var txn = connection.transaction;
    if (!txn) { return; }

    var rcpt = params[0];
    var user = rcpt.user.split('+');

    if (user.length == 1) {
        return success(params[0].user + '@' + params[0].host);
    }

    logger.logdebug("ReplyTO: " + user[1]);
    connection.transaction.notes.inreplyto = user[1];
    return success(user[0] + '@' + params[0].host);
};

exports.rcpt_to_all = function(next, connection, params) {
	var plugin = this;
    var txn = connection.transaction;
    if (!txn) { return; }

    var rcpt = params[0];

    async.auto({
    	hasHost: function(cb) {
    		if (!rcpt.host) {
    			txn.results.add(plugin, {fail: 'rcpt!domain'});
		        return cb('Recipient domain invalid');
		    }
		    cb(null, true);
    	},
    	isDomainValid: ['hasHost', function(cb) {
    		client.sismember('domains:receivable', rcpt.host, function(err, res) {
    			if (err) {
    				logger.logdebug("Redis error: " + err);
    				cb('Internal error, please try again later');
    			}
    			if (res == 0) return cb('Recipient invalid');
    			cb(null, true);
    		});
    	}]
    }, function(err, res) {
    	if (err) return next(DENY, err);
    	client.publish('message:incoming', rcpt);
    	txn.results.add(plugin, {pass: 'accepted'});
    	next(OK);
    });
};