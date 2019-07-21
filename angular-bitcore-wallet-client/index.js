var bwcModule = angular.module('bwcModule', []);
var Client = require('../node_modules/bitcore-wallet-client');

bwcModule.constant('MODULE_VERSION', '1.0.0');

bwcModule.provider("bwcService", function() {
  var provider = {};

  var backends = [
    'https://navpay-api-1.navcoin.org/bws/api',
    'https://navpay-api.navcoin.org/bws/api',
  ];

  var chosenBackend = false;

  chooseBackend();

  function chooseBackend() {
    for(var i=0, l=backends.length; i<l; i++) {
      if (!chosenBackend) {
        chosenBackend = testBws(backends[i]);
      }//if
    }//for
  
    if (!chosenBackend) {
      chosenBackend = backends[0];
    }

  }

  function testBws(backend) {
    try {
      var xmlHttp = new XMLHttpRequest();
      xmlHttp.open( "GET", backend + '/v1/status', false ); // false for synchronous request
      xmlHttp.send( null );
      responseJson = JSON.parse(xmlHttp.responseText)
      if (responseJson.error === null) {
       return backend
      }     
    } catch (err) {
      return false
    }
    return false
  }

  provider.$get = function() {
    var service = {};

    service.getBitcore = function() {
      return Client.Bitcore;
    };

    service.chooseBackend = function() {
      chooseBackend();
    }

    service.getErrors = function() {
      return Client.errors;
    };

    service.getSJCL = function() {
      return Client.sjcl;
    };

    service.buildTx = Client.buildTx;
    service.parseSecret = Client.parseSecret;
    service.Client = Client;

    service.getUtils = function() {
      return Client.Utils;
    };

    service.getClient = function(walletData, opts) {
      opts = opts || {};
            
      var bwc = new Client({
        baseUrl: chosenBackend,
        verbose: opts.verbose,
        timeout: 100000,
        transports: ['polling'],
      });
    
      //note opts use `bwsurl` all lowercase;
      
      if (walletData)
        bwc.import(walletData, opts);
      return bwc;
    };
    return service;
  };

  return provider;
});
