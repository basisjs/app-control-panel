
  // default
  var config = resource('static.js');

  // choose suitable config
  if (global.chrome && global.chrome.extension)
    config = resource('plugin.js');
  else if (global.appcp_server)
    config = resource('server.js');

 /**
  * transport
  */
  (module.exports = basis.object.complete(config(), {
    isReady: false,
    handlers: {},

    ready: function(handler, context){
      if (this.isReady)
        handler.call(context);

      this.onMessage('ready', handler, context);
    },

    message: function(message){
      if (message.action == 'ready')
        this.isReady = true;

      var handlers = this.handlers[message.action];
      if (handlers)
        for (var i = 0, handler; handler = handlers[i]; i++)
          handler.handler.call(handler.context, message.data && message.data.toObject());
    },
    onMessage: function(message, handler, handlerContext){
      if (!this.handlers[message])
        this.handlers[message] = [];

      this.handlers[message].push({
        handler: handler,
        context: handlerContext
      });
    },
    
    call: function(){
    }
  })).init();