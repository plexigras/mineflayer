var Villager = require('../villager');
var assert = require('assert');
var version = require('../version');
var Item = require('prismarine-item')(version);
var windows = require('prismarine-windows')(version).windows;

module.exports = inject;

function noop(err) {
  if (err) throw err;
}

function inject(bot) {
  bot._client.registerChannel('MC|TrSel',['i32',[]]);
  bot._client.registerChannel('MC|TrList', [
    'container', [
      {'type': 'i32','name': 'windowId'},
      {
        'name': 'trades',
        'type': ['array', {
          'countType': 'i8',
          'type': ['container', [
            {'type': 'slot','name': 'first_input'},
            {'type': 'slot','name': 'output'},
            {'type': 'bool','name': 'has_second_item'},
            {
              'name': 'secondary_input',
              'type': ['switch',
                {
                  'compareTo': 'has_second_item',
                  'fields': {
                    'true': 'slot',
                    'false': 'void'
                  }
                }
              ]
            },
            {'type': 'bool','name': 'disabled'},
            {'type': 'i32','name': 'tooluses'},
            {'type': 'i32','name': 'max_tradeuses'}
          ]]
        }]
      }
    ]
  ]);
  
  function openVillager(villagerEntity) {
    assert.strictEqual(villagerEntity.entityType, 120);
    var ready = false;
    var villager = bot.openEntity(villagerEntity, Villager);
    villager.trades = null;
    
    bot._client.on('MC|TrList', gotTrades);
    villager.once('close', function() {
      bot._client.removeListener('MC|TrList', gotTrades);
    });
    
    return villager;
    
    function gotTrades(packet) {
      if(!villager.window) return;
      if(packet.windowId !== villager.window.id) return;
      assert.ok(packet.trades);
      villager.trades = packet.trades.map(function (trade) {
        return Object.assign(trade, {
          first_input: Item.fromNotch(trade.first_input || {blockId: -1}),
          secondary_input: Item.fromNotch(trade.secondary_input || {blockId: -1}),
          output: Item.fromNotch(trade.output || {blockId: -1})
        });
      });
      if (!ready) {
        ready = true;
        villager.emit('ready');
      }
    }
  }
  
  function trade(villager, index, count, cb) {
    cb = cb || noop;
    var choice = parseInt(index, 10); // allow string argument
    assert.notEqual(villager.trades, null);
    assert.notEqual(villager.trades[choice], null);
    var Trade = villager.trades[choice];
    count = count || Trade.max_tradeuses - Trade.tooluses;
    assert.ok(Trade.max_tradeuses - Trade.tooluses > 0, 'trade blocked');
    assert.ok(Trade.max_tradeuses - Trade.tooluses >= count);
    
    bot._client.writeChannel('MC|TrSel', choice);
    
    next();
    
    function next() {
      if (count === 0) {
        if (Trade.max_tradeuses - Trade.tooluses === 0) {
          Trade.disabled = true;
        }
        cb();
      } else {
        count--;
        putRequirements(villager.window, Trade, function (err) {
          if (err) {
            cb(err);
          } else {
            villager.window.updateSlot(2, Object.assign({}, Trade.output));
            bot.putAway(2, function(err) {
              if(err) {
                cb(err);
              } else {
                villager.window.updateSlot(0, null);
                villager.window.updateSlot(1, null);
                Trade.tooluses++;
                next();
              }
            });
          }
        });
      }
    }
  }

  function putRequirements(window, Trade, cb) {
    deposit(window, Trade.first_input.type, Trade.first_input.metadata, Trade.first_input.count, 0, function (err) {
      if (err) {
        cb(err);
      } else if (Trade.has_second_item) {
        deposit(window, Trade.secondary_input.type, Trade.secondary_input.metadata, Trade.secondary_input.count, 1, function (err) {
          if (err) {
            cb(err);
          } else {
            cb();
          }
        });
      } else {
        cb();
      }
    });
  }
  
  function deposit(window, itemType, metadata, count, slot, cb) {
    var options = {
      window: window,
      itemType: itemType,
      metadata: metadata,
      count: count,
      sourceStart: window.inventorySlotStart,
      sourceEnd: window.inventorySlotStart + windows.INVENTORY_SLOT_COUNT,
      destStart: slot,
      destEnd: slot + 1
    };
    bot.transfer(options, cb);
  }

  bot.openVillager = openVillager;
  bot.trade = trade;
}
