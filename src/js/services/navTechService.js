'use strict';
/*
  This class lets interfaces with a NavTech Server's API.
*/

var NavTechService = function(opts) {
  var self = this;

  opts = opts || {};
  self.$log = opts.$log;
  self.httprequest = opts.httprequest; // || request;
  self.lodash = opts.lodash;
  self.storageService = opts.storageService;

  self.SAT_TO_BTC = 1 / 1e8;
  self.BTC_TO_SAT = 1e8;
  self.UNAVAILABLE_ERROR =
    'Service is not available - check for service.isAvailable() or use service.whenAvailable()';

  self._isAvailable = false;
  self._queued = [];

  self.delay = 20;
  self.encryptionLength = 344;

  self.jsencrypt = new JSEncrypt();

  self.availableServers = [];
};

var _navtechInstance;
NavTechService.singleton = function(opts) {
  if (!_navtechInstance) {
    _navtechInstance = new NavTechService(opts);
  }
  return _navtechInstance;
};

NavTechService.prototype._checkNode = function(numAddresses, callback) {
  var self = this;

  self.getNavTechServers(function(error, servers) {
    if (!servers || servers.length === 0) {
      self.runtime.callback(false, {
        message: 'No valid NavTech servers found'
      });
      return;
    }

    var retrieve = function() {
      if (servers.length === 0) {
        self.$log.debug('Tried all NavTech Servers');
        self.runtime.callback(false, {
          message:
            'Failed to communicate with NavTech servers. Please goto settings and check you configuration.'
        });
        return false;
      }

      var randomIndex = Math.floor(Math.random() * servers.length);
      var navtechServerUrl = servers[randomIndex] + '/api/check-node';

      // self.$log.debug('Fetching navtech server data');
      self.httprequest
        .post(navtechServerUrl, { num_addresses: numAddresses })
        .success(function(res) {
          if (res && res.type === 'SUCCESS' && res.data) {
            // self.$log.debug('Success fetching navtech data from server ' + availableServers[randomIndex], res);
            //@TODO check if amount is larger than server max amount
            self.runtime.serverInfo = {
              maxAmount: res.data.max_amount,
              minAmount: res.data.min_amount,
              navtechFeePercent: res.data.transaction_fee
            };

            callback(res.data, self, 0);
          } else {
            self.$log.debug(
              'Bad response from navtech server ' + servers[randomIndex],
              res
            );
            servers.splice(randomIndex, 1);
            retrieve();
          }
        })
        .error(function(err) {
          self.$log.debug('Error fetching navtech server data', err);
          servers.splice(randomIndex, 1);
          retrieve();
        });
    };

    retrieve();
  });
};

NavTechService.prototype._splitPayment = function(navtechData, self) {
  var amount = Math.ceil(
    self.runtime.amount / (1 - parseFloat(navtechData.transaction_fee) / 100)
  );

  var max = 6;
  var min = 2;
  var numTxes = Math.floor(Math.random() * (max - min + 1)) + min;
  var runningTotal = 0;
  var rangeMiddle = amount / numTxes;
  var rangeTop = Math.floor(rangeMiddle * 1.5);
  var rangeBottom = Math.floor(rangeMiddle * 0.5);
  var amounts = [amount];

  self.runtime.amounts = amounts;
  self._encryptTransactions(navtechData, self, 0);

  return;

  for (var i = 0; i < numTxes; i++) {
    if (runningTotal < amount) {
      var randSatoshis = Math.floor(
        Math.random() * (rangeTop - rangeBottom) + rangeBottom
      );
      if (randSatoshis > amount - runningTotal || i === numTxes - 1) {
        var remainingAmount = Math.round(amount - runningTotal);
        amounts.push(remainingAmount);
        runningTotal += remainingAmount;
      } else {
        amounts.push(randSatoshis);
        runningTotal += randSatoshis;
      }
    }
  }

  if (runningTotal === amount && amounts.length > 1) {
    self.runtime.amounts = amounts;
    self._encryptTransactions(navtechData, self, 0);
  } else {
    // self.$log.debug('Failed to split payment');
    self.runtime.callback(false, { message: 'Failed to split payment' });
    return false;
  }
};

NavTechService.prototype._encryptTransactions = function(
  navtechData,
  self,
  counter
) {
  var payments = [];
  var numPayments = self.runtime.amounts.length;

  for (var i = 0; i < numPayments; i++) {
    var payment = self.runtime.amounts[i];
    try {
      var timestamp = new Date().getUTCMilliseconds();
      var dataToEncrypt = {
        n: self.runtime.address,
        t: self.delay,
        p: i + 1,
        o: numPayments,
        u: timestamp
      };

      self.jsencrypt.setPublicKey(navtechData.public_key);

      var encrypted = self.jsencrypt.encrypt(JSON.stringify(dataToEncrypt));

      if (encrypted.length !== self.encryptionLength && counter < 10) {
        // self.$log.debug('Failed to encrypt the payment data... retrying', counter, encrypted.length, encrypted);
        self._encryptTransactions(navtechData, self, counter++);
        return;
      } else if (encrypted.length !== self.encryptionLength && counter >= 10) {
        // self.$log.debug('Failed to encrypt the payment data... exiting', counter, encrypted.length, encrypted);
        self.runtime.callback(false, {
          message: 'Failed to encrypt the payment data'
        });
        return;
      }

      payments.push({
        amount: self.runtime.amounts[i],
        address: navtechData.nav_addresses[i],
        anonDestination: encrypted
      });
    } catch (err) {
      // self.$log.debug('Threw error encrypting the payment data', err);
      self.runtime.callback(false, {
        message: 'Threw error encrypting the payment data'
      });
      return;
    }
  }
  self.runtime.callback(true, payments, self.runtime.serverInfo);
};

NavTechService.prototype.findNode = function(amount, address, callback) {
  if (!amount || !address) {
    callback(false, { message: 'invalid params' });
    return;
  }

  if (amount < 5 * 1e8) {
    //@TODO move this to the server response.
    callback(false, { message: 'Amount is too small, minimum is 5 NAV' });
    return;
  }

  if (amount > 10000 * 1e8) {
    //@TODO move this to the server response.
    callback(false, { message: 'Amount is too large, maximum is 10,000 NAV' });
    return;
  }

  var self = this;
  self.runtime = {};
  self.runtime.callback = callback;
  self.runtime.address = address;
  self.runtime.amount = amount;
  self._checkNode(6, self._splitPayment);
};

NavTechService.prototype.addNode = function(newServer, callback) {
  var self = this;
  // Add https if needed. remove trailing / if needed.
  var formattedUrl = newServer.toLowerCase();
  var serverURL =
    formattedUrl.indexOf('https://') === -1
      ? 'https://' + formattedUrl
      : formattedUrl;
  serverURL =
    serverURL[serverURL.length - 1] === '/'
      ? serverURL.slice(0, -1)
      : serverURL;

  self.getNavTechServers(function(error, servers) {
    self.availableServers = servers;

    // If its already in the list. Exit
    if (self.availableServers.indexOf(serverURL) !== -1) {
      return callback(false, self.availableServers);
    }

    self.httprequest
      .post(serverURL + '/api/check-node', { num_addresses: 1 })
      .then(
        function successCB(res) {
          if (res && res.data && res.data.type === 'SUCCESS') {
            self.availableServers.push(serverURL);

            self.storageService.setNavTechServers(
              self.availableServers,
              function(error) {
                if (error) {
                  return callback(error);
                }
                self.$log.debug(
                  'Added new NavTech Server:' + serverURL,
                  self.availableServers
                );

                callback(false, self.availableServers);
              }
            );
          } else {
            // API had incorrect response. Failed.
            callback(res);
          }
        },
        function errorCB(res) {
          callback(res);
        }
      );
  });
};

NavTechService.prototype.removeNode = function(serverAddress, callback) {
  var self = this;

  var updatedServerList = self.availableServers.filter(function(i) {
    return i !== serverAddress;
  });

  self.availableServers = updatedServerList;

  self.storageService.setNavTechServers(self.availableServers, function(error) {
    if (error) {
      return callback(error);
    }
    self.$log.debug('Removed:' + serverAddress, self.availableServers);

    callback(false, self.availableServers);
  });
};

NavTechService.prototype.getNavTechServers = function(callback) {
  var self = this;
  if (self.availableServers.length !== 0) {
    callback(false, self.availableServers);
  } else {
    self.storageService.getNavTechServers(function(error, servers) {
      if (error) {
        callback(error);
      }
      if (servers) {
        self.availableServers = JSON.parse(servers);
      }

      callback(false, self.availableServers);
    });
  }
};

angular
  .module('copayApp.services')
  .factory('navTechService', function($http, lodash, $log, storageService) {
    var cfg = {
      httprequest: $http,
      lodash: lodash,
      $log: $log,
      storageService: storageService
    };

    return NavTechService.singleton(cfg);
  });
