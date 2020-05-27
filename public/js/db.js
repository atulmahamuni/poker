const mongoose = require('mongoose')
Table = require('/Users/rahulvaidun/Documents/poker/poker_modules/table.js')
const tableSchema  = mongoose.Schema({
    _id: mongoose.Schema.Types.ObjectId,
    name:String
    
});

module.exports = mongoose.model('table', tableSchema)