(function(root, factory) {

    if (root.define && typeof root.define == 'function' && root.define.amd) {
        define([
            'jquery',
            'lodash',
            'backbone',
            'get',
            'set',
        ], function($, _, Backbone, get, set) {
            return factory(root, {}, $, _, Backbone, get, set);
        })
    } else {
        root.Block = factory(root, {}, $, _, Backbone, get, set);
    }

})(this, function(root, Block, $, _, Backbone, get, set) {

    function merge(object) {

        _.each([].slice.call(arguments, 1), function(source) {
            _.forOwn(source, function(value, key) {
                if (_.isPlainObject(value)) {
                    object[key] = merge({}, object[key], value);
                } else if (_.isArray(value)) {
                    object[key] = _.map(value, function(temp) {
                        if (_.isPlainObject(temp)) {
                            return merge({}, undefined, temp);
                        } else if (_.isArray(temp)) {
                            return merge([], undefined, temp);
                        } else {
                            return temp;
                        }
                    });
                } else {
                    object[key] = value;
                }
            });
        });

        return object;
    }

    Backbone.View.extend = function(protoProps, staticProps) {
        var parent = this;
        var child;

        if (protoProps && _.has(protoProps, 'constructor')) {
            child = protoProps.constructor;
        } else {
            child = function() {
                return parent.apply(this, arguments);
            };
        }

        _.extend(child, parent, staticProps);

        var Surrogate = function() {
            this.constructor = child;
        };

        Surrogate.prototype = parent.prototype;
        child.prototype = new Surrogate;

        if (protoProps) merge(child.prototype, protoProps);

        child.__super__ = parent.prototype;

        return child;
    };

    return Backbone.View.extend({

        constructor: function() {

            var block = this;

            var initialize = block.initialize;

            block.cid = _.uniqueId('block');

            block.initialize = function(data) {

                block.stopListening();

                merge(block, block.defaults, data);

                block.initCollections();
                block.initModels();

                block._ensureElement();

                block.trigger('initializing');

                return $.when(initialize.apply(block, arguments)).then(function() {

                    block.render();

                    block.startListening();

                    block.trigger('initialized');
                });
            };

            block.initialize.apply(block, arguments);

            block.delegateGlobalEvents();
        },

        globalEvents: {},
        listeners: {},
        events: {},
        defaults: {},
        children: {},
        template: null,

        prerender: function() {
            if(this.mark)
                this.$el.addClass("js-" + this.mark);
        },

        render: function() {

            var block = this,
                id = block.get('id'),
                $el = block.$el;

            block.removeBlocks();

            if (block.template) {
                block.setElement(block.template());
                block.prerender && block.prerender();
                $el && $el.replaceWith(block.el);
            }

            if (id) {
                block.el.id = id
            }

            block.el.block = block;

            block.initBlocks();

            setTimeout(function() {
                block.afterRender && block.afterRender();
            }, 0);
        },

        initCollections: function() {

            var block = this;

            block.collections = _.mapValues(block.collections, function(constructor, collectionName) {
                return block.get('collections.' + collectionName);
            });

            block.collection = block.get('collection');
        },

        initModels: function() {

            var block = this;

            block.models = _.mapValues(block.models, function(constructor, modelName) {
                return block.get('models.' + modelName);
            });

            block.model = block.get('model');
        },

        get: function() {

            var block = this,
                args = [block].concat([].slice.call(arguments));

            return get.apply(null, args);
        },

        set: function() {

            var block = this,
                args = [block].concat([].slice.call(arguments)),
                changed = set.apply(null, args);

            var triggerChanges = function(path, data) {

                if (_.isPlainObject(data)) {
                    _.forEach(data, function(data, key) {
                        triggerChanges(path ? (path + '.' + key) : key, data);
                    });
                }

                block.trigger.apply(block, [path ? ('change:' + path) : 'change', data].concat(args.slice(3)));
            };

            triggerChanges('', changed);

            return changed;
        },

        include: function(constructor, params) {

            var block = this,
                include;

            if (constructor.extend) {
                include = block.initBlock(constructor, params);
                include = '<' + include.el.tagName + ' block-cid="' + include.cid + '"></' + include.el.tagName + '>';
            } else {
                include = constructor.call(block, params);
            }

            return include;
        },

        initBlocks: function() {

            var block = this,
                $blocks = block.$('[block-cid]');

            $blocks.each(function() {

                var placeholder = this,
                    blockCid = placeholder.getAttribute('block-cid'),
                    child = block.children[blockCid];

                $(placeholder).replaceWith(child.el);

            });
        },

        initBlock: function(constructor, params) {

            var block = this,
                child = new constructor(_.extend({}, params, {
                    parent: block
                }));

            block.children[child.cid] = child;

            return child;
        },

        remove: function() {

            var block = this;

            block.stopListening();
            block.undelegateEvents();
            $(document).off('.' + block.cid);

            block.removeBlocks();

            block.parent && delete block.parent[block.cid];

            Backbone.View.prototype.remove.apply(block, arguments);
        },

        removeBlocks: function() {

            var block = this;

            _.each(block.children, function(blockToRemove) {

                if (blockToRemove && typeof blockToRemove.remove === 'function') {
                    blockToRemove.remove();
                }

            });

            block.children = {};
        },

        trigger: function(event, data) {

            var block = this,
                args = [].slice.call(arguments);

            block.$el.trigger(event, args.slice(1));

            return Backbone.View.prototype.trigger.apply(block, arguments);
        },

        delegateGlobalEvents: function() {

            var block = this;

            $(document).off('.' + block.cid);

            _.each(block.globalEvents, function(handler, event) {
                var path = event.split(' '),
                    eventName = path.shift();

                if (path.length) {
                    $(document).on(eventName + '.' + block.cid, path.join(' '), handler.bind(block));
                } else {
                    $(document).on(eventName + '.' + block.cid, handler.bind(block));
                }

            });
        },

        startListening: function() {

            var block = this,
                listeners = block.get('listeners');

            _.forEach(listeners, function(listener, path) {

                var normalizedListener;

                if (_.isPlainObject(listener)) {

                    normalizedListener = _.mapValues(listener, function(value) {

                        if (typeof value === 'string') {
                            return function() {
                                block[value].apply(block, arguments);
                            }
                        } else {
                            return value;
                        }
                    });

                    block.get(path) && block.listenTo(block.get(path), normalizedListener);

                } else {

                    if (typeof listener === 'string') {
                        normalizedListener = function() {
                            block[listener].apply(block, arguments);
                        };
                    } else {
                        normalizedListener = listener;
                    }

                    block.listenTo(block, path, normalizedListener);

                }

            });
        },

        generateClassName: function(baseClass, modifiers) {

            var block = this;

            block.baseClass = block.baseClass || baseClass;

            return _.reduce(modifiers || block.modifiers || [], function(result, value, name) {
                if (_.isBoolean(value)) {
                    if (value) {
                        return result + ' ' + baseClass + '_' + name;
                    } else {
                        return result;
                    }
                }
                return result + ' ' + baseClass + '_' + name + '_' + value;
            }, baseClass);
        },

        setModifiers: function(modifiers) {
            var block = this;

            block.modifiers = block.modifiers || {};

            _.each(modifiers, function(value, key) {
                block.modifiers[key] = value;
            });

            if (block.$el && block.baseClass) {
                block.$el.attr('class', block.generateClassName(block.baseClass, block.modifiers));

                if (block.mark) {
                    block.$el.addClass('js-' + block.mark);
                }
            }
        }

    });

});
