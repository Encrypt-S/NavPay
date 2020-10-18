'use strict';

var TAB_HOME_LISTENERS = [];


angular.module('copayApp.controllers').controller('tabHomeController',
  function($rootScope, $timeout, $scope, $state, $stateParams, $ionicModal, $ionicScrollDelegate, $window, gettextCatalog, lodash, popupService, ongoingProcess, externalLinkService, latestReleaseService, profileService, walletService, configService, $log, platformInfo, storageService, txpModalService, appConfigService, startupService, addressbookService, feedbackService, bwcError, nextStepsService, buyAndSellService, homeIntegrationsService, bitpayCardService, pushNotificationsService, timeService) {
    var wallet;
    var notifications = [];
    $scope.externalServices = {};
    $scope.openTxpModal = txpModalService.open;
    $scope.version = $window.version;
    $scope.name = appConfigService.nameCase;
    $scope.homeTip = $stateParams.fromOnboarding;
    $scope.buyNavTip = false;
    $scope.isCordova = platformInfo.isCordova;
    $scope.isAndroid = platformInfo.isAndroid;
    $scope.isMobile = platformInfo.isMobile;
    $scope.isIOS = platformInfo.isIOS;
    $scope.isIOSNativeApp = platformInfo.isCordova && platformInfo.isIOS
    $scope.isWindowsPhoneApp = platformInfo.isCordova && platformInfo.isWP;
    $scope.isNW = platformInfo.isNW;
    $scope.showRateCard = {};
    $scope.loadingWallets = true;

    $scope.$on("$ionicView.beforeEnter", function(event, data) {
      if(navigator.onLine === false) {
        // We shouldn't reach here. But just encase.
        $state.go('offline');
      }

      if (!$scope.homeTip) {
        storageService.getHomeTipAccepted(function(error, value) {
          $scope.homeTip = (value == 'accepted') ? false : true;
        });
      }

      storageService.getBuyNavTipAccepted(function(error, value) {
        $scope.buyNavTip = (value == 'accepted') ? false : true;
      });

      storageService.getFeedbackInfo(function(error, info) {

        if ($scope.isWindowsPhoneApp) {
          $scope.showRateCard.value = false;
          return;
        }
        if (!info) {
          initFeedBackInfo();
        } else {
          var feedbackInfo = JSON.parse(info);
          //Check if current version is greater than saved version
          var currentVersion = $scope.version;
          var savedVersion = feedbackInfo.version;
          var isVersionUpdated = feedbackService.isVersionUpdated(currentVersion, savedVersion);
          if (!isVersionUpdated) {
            initFeedBackInfo();
            return;
          }
          var now = moment().unix();
          var timeExceeded = (now - feedbackInfo.time) >= 24 * 7 * 60 * 60;
          $scope.showRateCard.value = timeExceeded && !feedbackInfo.sent;
          $timeout(function() {
            $scope.$apply();
          });
        }
      });

      function initFeedBackInfo() {
        var feedbackInfo = {};
        feedbackInfo.time = moment().unix();
        feedbackInfo.version = $scope.version;
        feedbackInfo.sent = false;
        storageService.setFeedbackInfo(JSON.stringify(feedbackInfo), function() {
          $scope.showRateCard.value = false;
        });
      };
    });

    $scope.$on("$ionicView.enter", function(event, data) {
      updateAllWallets();

      addressbookService.list(function(err, ab) {
        if (err) $log.error(err);
        $scope.addressbook = ab || {};
      });

      // Because on leave view is broken (Ionic: will not fix). We set this globally
      // To make sure we dont keep re-binding the listeners
      if (TAB_HOME_LISTENERS.length === 0) {
        TAB_HOME_LISTENERS = [
          $rootScope.$on('profileBound', function(e, walletId, type, n) {
            updateAllWallets();
            $scope.loadingWallets = false;
            if ($scope.recentTransactionsEnabled) getNotifications();
          }),
          $rootScope.$on('bwsEvent', function(e, walletId, type, n) {
            var wallet = profileService.getWallet(walletId);
            updateWallet(wallet);
            // If we just got a notification, we don't need to look for notifications again
            // if ($scope.recentTransactionsEnabled) getNotifications();
          }),
          $rootScope.$on('Local/TxAction', function(e, walletId) {
            $log.debug('Got action for wallet ' + walletId);
            var wallet = profileService.getWallet(walletId);
            updateWallet(wallet);
            if ($scope.recentTransactionsEnabled) getNotifications();
          })
        ];
      }


      $scope.buyAndSellItems = buyAndSellService.getLinked();
      $scope.homeIntegrations = homeIntegrationsService.get();

      bitpayCardService.get({}, function(err, cards) {
        $scope.bitpayCardItems = cards;
      });

      configService.whenAvailable(function(config) {
        $scope.recentTransactionsEnabled = config.recentTransactions.enabled;
        if ($scope.recentTransactionsEnabled) getNotifications();

        if (config.hideNextSteps.enabled) {
          $scope.nextStepsItems = null;
        } else {
          $scope.nextStepsItems = nextStepsService.get();
        }

        pushNotificationsService.init();

        $timeout(function() {
          $ionicScrollDelegate.resize();
          $scope.$apply();
        }, 10);
      });

      $timeout(function() {
        // If  haven't loaded wallets in 2.5s. Show create wallet.
        // Handles issues when no wallets exist and you are navigating the app
        $scope.loadingWallets = false;
      }, 2500);

      $timeout(function() {
        $rootScope.$apply();
      }, 10);
    });

    $scope.$on("$ionicView.afterEnter", function() {
      startupService.ready();
    });

    // $scope.$on("$ionicView.leave", function(event, data) {
      // This never runs. So.... we made listenrs into TAB_HOME_LISTENERS
      // and remove them in the routes.js

      // lodash.each(listeners, function(x) {
      //   console.log('tab-home - ionic on leave')
      //   x();
      // });
    // });


    $scope.createdWithinPastDay = function(time) {
      return timeService.withinPastDay(time);
    };

    $scope.openExternalLink = function() {
      var url = 'https://github.com/bitpay/copay/releases/latest';
      var optIn = true;
      var title = gettextCatalog.getString('Update Available');
      var message = gettextCatalog.getString('An update to this app is available. For your security, please update to the latest version.');
      var okText = gettextCatalog.getString('View Update');
      var cancelText = gettextCatalog.getString('Go Back');
      externalLinkService.open(url, optIn, title, message, okText, cancelText);
    };

    $scope.openNotificationModal = function(n) {
      wallet = profileService.getWallet(n.walletId);

      if (n.txid) {
        $state.transitionTo('tabs.wallet.tx-details', {
          txid: n.txid,
          walletId: n.walletId
        });
      } else {
        var txp = lodash.find($scope.txps, {
          id: n.txpId
        });
        if (txp) {
          txpModalService.open(txp);
        } else {
          ongoingProcess.set('loadingTxInfo', true);
          walletService.getTxp(wallet, n.txpId, function(err, txp) {
            var _txp = txp;
            ongoingProcess.set('loadingTxInfo', false);
            if (err) {
              $log.warn('No txp found');
              return popupService.showAlert(gettextCatalog.getString('Error'), gettextCatalog.getString('Transaction not found'));
            }
            txpModalService.open(_txp);
          });
        }
      }
    };

    $scope.reloadPage = function() {
      console.log('reloadPage')
      $window.location.reload();
    };

    $scope.walletError = function(wallets) {
      var hasError = false
      for (var i = 0, l = wallets.length; i<l; i++) {
        if (wallets[i].error) hasError = true
      }
      return hasError
    }

    $scope.openBuyLink = function() {
      $state.go('tabs.changelly');
    };

    $scope.openWallet = function(wallet) {
      if (!wallet.isComplete()) {
        return $state.go('tabs.copayers', {
          walletId: wallet.credentials.walletId
        });
      }

      $state.go('tabs.wallet', {
        walletId: wallet.credentials.walletId
      });
    };

    var updateTxps = function() {
      profileService.getTxps({
        limit: 3
      }, function(err, txps, n) {
        if (err) $log.error(err);
        $scope.txps = txps;
        $scope.txpsN = n;
        $timeout(function() {
          $ionicScrollDelegate.resize();
          $scope.$apply();
        }, 10);
      })
    };

    var updateAllWallets = function() {
      $scope.wallets = profileService.getWallets();
      if (lodash.isEmpty($scope.wallets)) return;

      var i = $scope.wallets.length;
      var j = 0;
      var timeSpan = 60 * 60 * 24 * 7;

      lodash.each($scope.wallets, function(wallet) {
        walletService.getStatus(wallet, {}, function(err, status) {
          if (err) {

            if (err === 'WALLET_NOT_REGISTERED') {
              walletService.recreate(wallet, function(err) {
                if (err) return;
                $timeout(function() {
                  walletService.startScan(wallet, function() {
                    $timeout(function() {
                      $scope.$apply();
                    });
                  }, false);
                });
              }, false);
            } else {
              wallet.error =  bwcError.msg(err);
            }

            //wallet.error = (err === 'WALLET_NOT_REGISTERED') ? gettextCatalog.getString('Wallet not registered') : bwcError.msg(err);

            $log.error(err);
          } else {
            wallet.error = null;
            wallet.status = status;

            // TODO service refactor? not in profile service
            profileService.setLastKnownBalance(wallet.id, wallet.status.totalBalanceStr, function() {});
          }
          if (++j == i) {
            updateTxps();
          }
        });
      });
      $scope.loadingWallets = false;
      $timeout(function() {
        $rootScope.$apply();
      }, 10);
    };

    var updateWallet = function(wallet) {
      $log.debug('Updating wallet:' + wallet.name)
      walletService.getStatus(wallet, {}, function(err, status) {
        if (err) {
          $log.error(err);
          return;
        }
        wallet.status = status;
        updateTxps();
      });
    };

    var getNotifications = function() {
      profileService.getNotifications({
        limit: 3
      }, function(err, notifications, total) {
        if (err) {
          $log.error(err);
          return;
        }
        $scope.notifications = notifications;
        $scope.notificationsN = total;
        $timeout(function() {
          $ionicScrollDelegate.resize();
          $scope.$apply();
        }, 10);
      });
    };

    $scope.hideHomeTip = function() {
      storageService.setHomeTipAccepted('accepted', function() {
        $scope.homeTip = false;
        $timeout(function() {
          $scope.$apply();
        })
      });
    };

    $scope.hideBuyNavTip = function() {
      storageService.setBuyNavTipAccepted('accepted', function() {
        $scope.buyNavTip = false;
        $timeout(function() {
          $scope.$apply();
        })
      });
    };


    $scope.onRefresh = function() {
      $timeout(function() {
        $scope.$broadcast('scroll.refreshComplete');
      }, 300);
      updateAllWallets();
    };

    $scope.openChangellyWeb = function() {
      var url = 'https://changelly.com/exchange/USD/NAV/100';
      var optIn = true;
      var title = null;
      var message = gettextCatalog.getString('Visit Changelly.com');
      var okText = gettextCatalog.getString('Open Website');
      var cancelText = gettextCatalog.getString('Go Back');
      externalLinkService.open(url, optIn, title, message, okText, cancelText);
    };
  });
