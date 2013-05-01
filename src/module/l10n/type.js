
  basis.require('basis.data');
  basis.require('basis.data.dataset');
  basis.require('basis.entity');
  basis.require('app.type');

  var nsEntity = basis.entity;
  var EntityType = basis.entity.EntityType;

  var Split = basis.data.dataset.Split;
  var Merge = basis.data.dataset.Merge;
  var Subset = basis.data.dataset.Subset;

  var getter = Function.getter;

  var STATE = basis.data.STATE;


  var Dictionary = new EntityType({
    name: 'Dictionary',
    fields: {
      Dictionary: nsEntity.StringId,
      Location: String,
      Position: Number,
      ResourceModified: Boolean
    }
  });

  var Token = new EntityType({
    name: 'Token',
    fields: {
      Dictionary: nsEntity.StringId,
      Token: nsEntity.StringId,
      Position: Number
    }
  });

  var Resource = new EntityType({
    name: 'Resource',
    fields: {
      Dictionary: nsEntity.StringId,
      Token: nsEntity.StringId,
      Culture: nsEntity.StringId,
      Value: String
    }
  });

  var DictionaryCulture = new EntityType({
    name: 'DictionaryCulture',
    fields: {
      Dictionary: nsEntity.StringId,
      Culture: nsEntity.StringId,
      Position: Number
    }
  });

  var Culture = new EntityType({
    name: 'Culture',
    fields: {
      Culture: nsEntity.StringId,
      Title: String
    }
  });

  //
  // Datasets
  //
  var resourceDictionaryCultureSplit = new Split({
    source: Resource.all,
    rule: function(object){
      return object.data.Dictionary + '_' + object.data.Culture;
    }
  });
  var resourceDictionaryCultureMerge = new Merge({});
  var resourceSplit = new Split({
    source: resourceDictionaryCultureMerge,
    rule: function(object){
      return object.data.Dictionary + '_' + object.data.Token;
    }
  });

  // dictionary culture
  var dictionaryCultureSplit = new Split({
    source: DictionaryCulture.all,
    rule: getter('data.Dictionary')
  });
  var dictionaryCultureDataset = new Subset({
    rule: Function.$true
  });

  var tokenSplit = new nsEntity.Grouping({
    source: Token.all,
    rule: getter('data.Dictionary'),
    wrapper: Token
  });
  var tokenDataset = new Subset({});

  // observe resource changes datasets
  var resourceModifiedSubset = new Subset({ 
    source: Resource.all,
    ruleEvents: { 
      rollbackUpdate: true,
      update: true
    },
    rule: function(object){
      return !!object.modified;
    }
  });
  resourceModifiedSubset.addHandler({
    datasetChanged: function(object, delta){
      var objects = [].concat(delta.inserted || [], delta.deleted || []);
      for (var i = 0, object; object = objects[i]; i++)
        Dictionary(object.data.Dictionary).set('ResourceModified', resourceModifiedSplit.getSubset(object.data.Dictionary, true).itemCount > 0, true);
    }
  });
  var resourceModifiedSplit = new Split({
    source: resourceModifiedSubset,
    rule: getter('data.Dictionary')
  });
  var resourceModifiedDataset = new Subset({
    rule: basis.fn.$true
  });

  //
  // extend Dictionary
  //
  var isServerOnline = false;

  Object.extend(Dictionary.entityType.entityClass.prototype, {
    save: function(){
      if (isServerOnline && this.modified && this.state != STATE.PROCESSING)
      {
        var modifiedCultures = {};
        var modifiedResources = resourceModifiedSplit.getSubset(this.data.Dictionary, true).getItems();
        for (var i = 0, resource; resource = modifiedResources[i]; i++) 
          modifiedCultures[resource.data.Culture] = true;

        var cultureList = [];
        for (var i in modifiedCultures)
          cultureList.push(i);

        app.transport.invoke('saveDictionary', this.data.Dictionary, this.data.Location, cultureList);
        this.setState(STATE.PROCESSING);
      }
    },
    reset: function(){
      this.setState(STATE.READY);
      resourceModifiedSplit.getSubset(this.data.Dictionary, true).getItems().forEach(function(token){
        token.rollback();
      });
    }
  });  


  //
  // add/remove culture
  //
  var usedCulturesDataset = new basis.data.Dataset({});  

  function addCulture(culture){
    var usedCulturesCount = usedCulturesDataset.getItems().length - 1;

    var dictionaries = Dictionary.all.getItems();
    for (var i = 0, dictionary; dictionary = dictionaries[i]; i++)
    { 
      DictionaryCulture({
        Dictionary: dictionary.data.Dictionary,
        Culture: culture,
        Position: usedCulturesCount
      });
    }
  }

  function deleteCulture(culture){
    var dictionaries = Dictionary.all.getItems();

    var culturePosition;
    if (dictionaries[0])
      culturePosition = DictionaryCulture({
        Culture: culture,
        Dictionary: dictionaries[0].data.Dictionary
      }).data.Position;

    for (var i = 0, dictionary; dictionary = dictionaries[i]; i++)
    {
      DictionaryCulture({ 
        Dictionary: dictionary.getId(), 
        Culture: culture 
      }).destroy();
    }

    if (culturePosition)
    {
      var cultures = DictionaryCulture.all.getItems().filter(function(item){ return item.data.Position > culturePosition }) || [];
      for (var i = 0, item; item = cultures[i]; i++)
        item.set('Position', item.data.Position - 1);
    }
  }

  usedCulturesDataset.addHandler({
    datasetChanged: function(object, delta){
      if (delta.inserted)
        for (var i = 0, culture; culture = delta.inserted[i]; i++)
          addCulture(culture.data.Culture);

      if (delta.deleted)
        for (var i = 0, culture; culture = delta.deleted[i]; i++)
          deleteCulture(culture.data.Culture);
    }
  });  

  //
  //load resource for current dictionary and added culture
  //
  var resourcesLoaded = {};
  
  dictionaryCultureDataset.addHandler({
    datasetChanged: function(object, delta){
      if (delta.inserted)
        for (var i = 0, dictCulture; dictCulture = delta.inserted[i]; i++)
        {
          var key = dictCulture.data.Dictionary + '_' + dictCulture.data.Culture;
          if (!resourcesLoaded[key])
          {
            app.transport.invoke('loadDictionaryResource', dictCulture.data.Dictionary, dictCulture.data.Culture);
            resourcesLoaded[key] = true;
          }
        }
    }
  });

  //
  // get dictionaries list from appProfile
  //
  var appProfile = app.type.AppProfile();

  appProfile.addHandler({
    targetChanged: function(object){
      if (object.data.l10n)
        processDictionaries(object.data.l10n);
    },
    update: function(object, delta){
      if (object.data.l10n)
        processDictionaries(object.data.l10n);
    }
  });
  
  if (appProfile.data.l10n)
    processDictionaries(appProfile.data.l10n);

  function processDictionaries(data){
    for (var dictName in data) {
      Dictionary({
        Dictionary: dictName,
        Location: data[dictName].path
      });

      processDictionaryData(dictName, data[dictName].tokens);
    }
  }

  //
  // process resources
  //
  function processDictionaryData(dictionary, data){
    var resource;
    var tokens = [];

    for (var token in data)
    {
      tokens.push(Token({ 
        Dictionary: dictionary, 
        Token: token 
      }));
      for (var culture in data[token])
      {
        resource = Resource({ 
          Dictionary: dictionary, 
          Token: token,
          Culture: culture
        });

        resource.commit({
          Value: data[token][culture]
        });
      }
    }

    //tokenSplit.getSubset(dictionary, true).sync(tokens);
  }  

  //
  // message handlers
  //
  app.transport.ready(function(){
    for (var i in resourcesLoaded)
      delete resourcesLoaded[i];

    app.transport.invoke('serverStatus');
    app.transport.invoke('loadCultureList');
    app.transport.invoke('loadDictionaryList');
  });

  app.transport.onMessage({
    serverStatus: function(isOnline){
      isServerOnline = isOnline;
    },

    cultureList: function(data){
      data.cultureList.push('base')
      Culture.all.sync(data.cultureList);
    },
    
    dictionaryList: function(data){
      data.map(Dictionary);
    },

    dictionaryResource: function(data){
      processDictionaryData(data.dictionaryName, data.tokens);
    },

    newDictionary: function(data){
      Dictionary(data.dictionaryName);
    },
          
    saveDictionary: function(data){
      if (data.result == 'success')
      {
        Dictionary(data.dictionaryName).setState(STATE.READY);
        processDictionaryData(data.dictionaryName, data.tokens);
      }
      else 
        Dictionary(data.dictionaryName).setState(STATE.ERROR, data.errorText);
    }
  });  
  
  //
  // exports
  //
  module.exports = {
    Dictionary: Dictionary,
    Token: Token,
    Resource: Resource,
    DictionaryCulture: DictionaryCulture,
    Culture: Culture,

    //datasets
    dictionaryCultureSplit: dictionaryCultureSplit,
    dictionaryCultureDataset: dictionaryCultureDataset,

    resourceDictionaryCultureSplit: resourceDictionaryCultureSplit,
    resourceDictionaryCultureMerge: resourceDictionaryCultureMerge,
    resourceSplit: resourceSplit,

    tokenSplit: tokenSplit,
    tokenDataset: tokenDataset,

    resourceModifiedSplit: resourceModifiedSplit,
    resourceModifiedSubset: resourceModifiedSubset,
    resourceModifiedDataset: resourceModifiedDataset,

    usedCulturesDataset: usedCulturesDataset,

    //saveDictionary: saveDictionary,
    addCulture: function(culture){ 
      usedCulturesDataset.add([Culture(culture)]);
    },
    deleteCulture: function(culture){ 
      usedCulturesDataset.remove([Culture(culture)]);
    },
    processDictionaryData: processDictionaryData
  }
