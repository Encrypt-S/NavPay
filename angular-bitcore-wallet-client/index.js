var bwcModule = angular.module('bwcModule', []);
var Client = require('../node_modules/bitcore-wallet-client');

bwcModule.constant('MODULE_VERSION', '1.0.0');

bwcModule.provider("bwcService", function() {
  var provider = {};

  var backends = [
    'https://navpay-api.navcoin.org/bws/api',
    'https://navpay-api-1.navcoin.org/bws/api',
    'https://navpay-api-3.navcoin.org/bws/api',
    'https://navpay-api-4.navcoin.org/bws/api',
    'https://navpay-api-5.navcoin.org/bws/api',
  ];

  var backendsToTry = JSON.parse(JSON.stringify(backends))

  var chosenBackend = false;

  chooseBackend();

  function chooseBackend() {

    var counter = 0
    while (!chosenBackend && counter < backends.length) {
      chosenBackend = testBws();
      counter++;
    }

  }

  function testBws() {

    if (backendsToTry.length == 0) {
      return false;
    }

    var index = Math.floor(Math.random() * Math.floor(backendsToTry.length-1));

    var backend = backendsToTry[index]

    try {
      var xmlHttp = new XMLHttpRequest();
      xmlHttp.open( "GET", backend + '/v1/status', false ); // false for synchronous request
      xmlHttp.send( null );
      responseJson = JSON.parse(xmlHttp.responseText)

      if (xmlHttp.status !== 200) {
        backendsToTry.splice(index, 1)
        return false
      }

      if (responseJson.error === null) {
       return backend
      }     
    } catch (err) {
      backendsToTry.splice(index, 1)
      return false
    }
    backendsToTry.splice(index, 1)
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
