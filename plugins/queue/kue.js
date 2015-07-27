var kue = require('kue');
var logger = require('./logger');

var q;
var queueName;

//This method registers the hook and try to initialize the connection to rabbitmq server for later use.
exports.register = function () {
    logger.logdebug("About to connect and initialize queue object");
    this.init_kue_server();
    logger.logdebug("Finished initiating queue object");
}


//Actual magic of publishing message to rabbit when email comes happen here.
exports.hook_queue = function(next, connection) {
    //Calling the get_data method and when it gets the data on callback, publish the message to queue with routing key.
    var stream = connection.transaction.message_stream.get_data(function(buffere) {
        if (q) {
            var job = q.create('incoming', {
                title: connection.transaction.uuid,
                message: {
                    date: connection.transaction.header.headers.date,
                    from: connection.transaction.mail_from,
                    to: connection.transaction.rcpt_to,
                    subject: connection.transaction.header.headers.subject,
                    headers: connection.transaction.header.header_list,
                    notes: connection.transaction.notes,
                    raw: buffere
                }
            }).save( function(err) {
                if( err ) {
                    logger.logdebug("queueFailure: #{JSON.stringify(err)}");
                    exports.init_kue_server();
                    return next();
                }
                logger.logdebug( "queueSuccess ID:" + job.id);
                return next(OK, "Successfully queued");
            });
        }
        else {
            //Seems like connExchange is not defined , lets create one for next call
            exports.init_kue_server();
            return next();
        }
    });
   
}

//This initializes the connection to redis-kue server, It reads values from redis-kue.ini file in config directory.
exports.init_kue_server = function() {
    var plugin = this;
    // this is called during init of redis-kue

    //Read the config file redis-kue
    var config = plugin.config.get('redis-kue.ini');
    var options = {};

    //Getting the values from config file redis-kue.ini
    if (config.rediskue) {
        options['host'] = config.rediskue.server_ip || '127.0.0.1';
        options['port'] = config.rediskue.server_port || '5672';
        options['db'] = config.rediskue.server_db || '0';
        queueName = config.rediskue.queueName || 'emails';
    }
    else {
        //If config file is not available , lets get the default values
        options['host'] = '127.0.0.1';
        options['port'] = '5672';
        options['db'] = '0';
        queueName = 'emails';
    }

    logger.logdebug("Connecting to Redis Kue " + options['host'] + ":" + options['port'] + "/" + options['db'] + "/" + queueName);

    q = kue.createQueue({
      prefix: queueName,
      redis: {
        port: options['port'],
        host: options['host'],
        db: options['db']
      }
    });
}