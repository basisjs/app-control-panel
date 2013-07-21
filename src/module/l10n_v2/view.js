
  basis.require('basis.dom');
  basis.require('basis.dom.event');
  basis.require('basis.data');
  basis.require('basis.cssom');
  basis.require('basis.entity');
  basis.require('basis.ui');
  basis.require('basis.ui.field');
  basis.require('basis.ui.button');
  basis.require('basis.data.property');
  basis.require('basis.net');
  basis.require('basis.ui.resizer');

  //var dictionaries;

  var l10nType = resource('type.js')();
  app.l10nType = l10nType;

  var Dictionary = l10nType.Dictionary;
  var Token = l10nType.Token;
  var Resource = l10nType.Resource;
  var Culture = l10nType.Culture;
  var DictionaryCulture = l10nType.DictionaryCulture;

  var property_CurrentCulture = new basis.data.property.Property(null);
  var property_CurrentDictionary = new basis.data.property.Property(null);
  var property_CurrentToken = new basis.data.property.Property(null);

  var dictionaryFile = new basis.data.DataObject({
    active: true,
    handler: {
      update: function(){
        l10nType.processDictionaryData(this.data.filename, JSON.parse(this.data.content));
      }
    }
  });

  // current dictionary changed
  property_CurrentDictionary.addHandler({
    change: function(property){
      var value = property.value;

      dictionaryFile.setDelegate(app.type.File(value));

      l10nType.dictionaryCultureDataset.setSource(value ? l10nType.dictionaryCultureSplit.getSubset(value, true) : null);
      l10nType.tokenDataset.setSource(value ? l10nType.tokenSplit.getSubset(value, true) : null);

      if (value)
      {
        var cultures = l10nType.usedCulturesDataset.getItems();
        var tokens = l10nType.tokenDataset.getItems();
        createEmptyResources(tokens, cultures);

        for (var i = 0, culture; culture = cultures[i]; i++)
        {
          l10nType.DictionaryCulture({
            Dictionary: value,
            Culture: culture.data.Culture,
            Position: i
          });
        }
      }

      l10nType.resourceDictionaryCultureMerge.clear();

      if (value)
      {
        var cultures = l10nType.usedCulturesDataset.getItems();
        for (var i = 0, culture; culture = cultures[i]; i++)
          l10nType.resourceDictionaryCultureMerge.addSource(l10nType.resourceDictionaryCultureSplit.getSubset(value + '_' + culture.data.Culture, true));
      }

      l10nType.resourceModifiedDataset.setSource(value ? l10nType.resourceModifiedSplit.getSubset(value, true) : null);
    }
  });

  l10nType.usedCulturesDataset.addHandler({
    datasetChanged: function(object, delta){
      if (delta.inserted)
      {
        var tokens = l10nType.tokenDataset.getItems();
        var cultures = delta.inserted;
        createEmptyResources(tokens, cultures);

        for (var i = 0, culture; culture = cultures[i]; i++)
          l10nType.resourceDictionaryCultureMerge.addSource(l10nType.resourceDictionaryCultureSplit.getSubset(property_CurrentDictionary.value + '_' + culture.data.Culture, true));
      }
        
      if (delta.deleted)
        for (var i = 0, culture; culture = delta.deleted[i]; i++)
          l10nType.resourceDictionaryCultureMerge.removeSource(l10nType.resourceDictionaryCultureSplit.getSubset(property_CurrentDictionary.value + '_' + culture.data.Culture, true));
    }
  });

  l10nType.tokenDataset.addHandler({
    datasetChanged: function(object, delta){
      if (delta.inserted)
        createEmptyResources(delta.inserted, l10nType.usedCulturesDataset.getItems());
    }
  });

  function createEmptyResources(tokens, cultures){
    for (var i = 0, culture; culture = cultures[i]; i++)
    {
      for (var j = 0, token; token = tokens[j]; j++)
      {
        if (/string|key|index/.test(token.data.TokenType))
          Resource({ 
            Dictionary: property_CurrentDictionary.value, 
            Token: token.data.Token,
            Culture: culture.data.Culture
          });
      }
    }    
  }

  //
  // Layout
  //

  //save button
  var saveButtonPanel = resource('module/saveButtonPanel/index.js').fetch();
  property_CurrentDictionary.addLink(saveButtonPanel, function(value){
    this.setDelegate(Dictionary(value));
  });

  //dictionary list
  var dictionaryList = resource('module/dictionaryList/index.js').fetch();
  dictionaryList.setDataSource(Dictionary.all);
  property_CurrentDictionary.addLink(dictionaryList, function(value){
    this.setValue(value);
  });
  dictionaryList.selection.addHandler({
    datasetChanged: function(){
      var item = this.pick();
      property_CurrentDictionary.set(item && item.data.Dictionary);
    }
  });

  var dictionaryListMatchInput = new basis.ui.field.MatchInput({
    template: resource('template/dictionaryListMatchInput.tmpl'),
    matchFilter: {
      node: dictionaryList,
      startPoints: '^|\\.|\/',
      textNodeGetter: 'tmpl.title'
    },
    binding: {
      example: cancelFilterButton
    }
  });
  
  var cancelFilterButton = new basis.ui.Node({
    container: dictionaryListMatchInput.element,
    template: resource('template/cancelFilterButton.tmpl'),
    action: {
      click: function(){
        dictionaryListMatchInput.setValue('');
      }
    }
  });
  dictionaryListMatchInput.matchFilter.addLink(cancelFilterButton, function(value){
    basis.cssom.display(this.element, !!value);
  });


  //dictionary editor 

  var dictionaryEditor = resource('module/editor/index.js')();
  property_CurrentDictionary.addLink(dictionaryEditor, function(value){
    basis.cssom.display(this.element, !!value);
  });

  // layout

  var layout = new basis.ui.Node({
    template: resource('template/layout.tmpl'),

    binding: {
      matchInput: dictionaryListMatchInput,
      dictionaryList: dictionaryList,
      dictionaryEditor: dictionaryEditor,
      saveButtonPanel: saveButtonPanel
    }
  });

  new basis.ui.resizer.Resizer({
    element: layout.tmpl.sidebar
  });

  
  //
  // message handlers
  //
  var lastDictionary;
  app.transport.ready(function(){
    lastDictionary = property_CurrentDictionary.value;
    property_CurrentDictionary.set(null);
  });

  app.transport.onMessage({
    serverStatus: function(isOnline){
      saveButtonPanel.inactive = !isOnline;
      saveButtonPanel.updateBind('inactive');
    },
    cultureList: function(data){
      property_CurrentCulture.set(data.currentCulture);
      l10nType.addCulture(data.currentCulture);
    },
    
    cultureChanged: function(data){  
      property_CurrentCulture.set(data);
    },
    
    dictionaryList: function(data){
      if (lastDictionary)
      {
        property_CurrentDictionary.set(lastDictionary);
        lastDictionary = null;
      }
    },

    /*dictionaryResource: function(data){
      if (property_CurrentToken.value)
      {  
        dictionaryEditor.selectResource(property_CurrentToken.value, property_CurrentCulture.value);
        property_CurrentToken.reset();
      }
    },*/

    token: function(data){
      property_CurrentDictionary.set(data.dictionaryName);

      var dc = DictionaryCulture.get({ 
        Dictionary: data.dictionaryName, 
        Culture: property_CurrentCulture.value 
      });
      if (!dc)
        l10nType.addCulture(property_CurrentCulture.value);

      
      selectToken(data.selectedToken);
    }
  });  

  function selectToken(token){
    var resource = Resource({
      Dictionary: property_CurrentDictionary.value,
      Culture: property_CurrentCulture.value,
      Token: token
    });

    dictionaryEditor.selectResource(resource);
  }

  /*dictionaryFile.addHandler({
    update: function(){
      if (currentToken)
      {
        selectToken(currentToken);
        currentToken = null;
      }
    }
  });*/

  //
  // exports
  //
  module.exports = layout;
