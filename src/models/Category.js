import mongoose, { model, Schema, models } from 'mongoose';

const CategorySchema = new Schema({
    name: {type: String, require: true},
    parent: {type: mongoose.Types.ObjectId, ref:'Category'},
    properties: [{type: Object}],
    images: [{
        full: {type: String},
        thumb: {type: String}
    }], // Array of image objects with full and thumb URLs

});

export default models?.Category || model('Category', CategorySchema);

export const Category = models?.Category || model('Category', CategorySchema);