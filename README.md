# j2s

JSON to SQL, build RESTful API server that accepts JSON describing SQL query statements, and do CRUD accordingly, with configurable access control.

* Tired of creating API every time that front-end requires new feature?
* Your front-end development always are lagged due to backend API not yet ready?

j2s provides extreme flexibility to let front-end compose powerful query statements via JSON,
and let backend do CRUD accordingly.

j2s relies on [Bookshelf.js](http://bookshelfjs.org/) for data modeling, and maps
url routes to models according to user configured options, and provides RESTful API
for these routes. Note that Bookshelf relies on [knex.js](http://knexjs.org/) for query building,
you'll need that dependency as well.

j2s are currently tested to work with [koa.js](http://koajs.com/) and works fine.

Supported JSON for a query will looks like:
```json
{
    "where": {
        "user.id__gt": 1,
        "user.id__lt": 10,
        "user.id__between": [1, 10],
        "user.id__not_between": [11, 13],
        "username__ne": "yo",
        "username__in": ["test1", "test2", "test4", "test6"],
        "or": {
            "username": "test",
            "user.id__in": [1, 2, 3]
        }
    },
    "join": {
        "photo": {
            "user.photo_id": "photo.id"
        }
    },
    "populate": ["photo"],
    "select": ["user.id as user_id", "user.username", "photo.url as photo_url"],
    "limit": 10,
    "offset": 1,
    "order_by": ["user.id", "desc"]
}
```

# Usage

Following shows an working example with proper environments
and how you could setup j2s routes with access control,
we assume that User has an one-to-many relation with Photo,
and User has an many-to-many relation to Book.

```javascript
// model.js
const knex = require('knex')({
    client: 'postgresql', // or any knex supported client
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        charset: 'utf8'
    }
});

const bookshelf = require('bookshelf')(knex);

const User = bookshelf.Model.extend({
    tableName: 'user',
    hasTimestamps: true,

    photo: function() {
        return this.belongsTo(Photo, 'photo_id');
    },

    books: function() {
        return this.belongsToMany(Book)
    }
})

const Photo = bookshelf.Model.extend({
    tableName: 'photo',
    hasTimestamps: true,
})

const Book = bookshelf.Model.extend({
    tableName: 'book',
    hasTimestamps: true,

    authors: function() {
        return this.belongsToMany(User)
    }
})

module.exports = {
    User: User,
    Photo: Photo,
    Book: Book
}
```

```javascript
// routes.js
const J2S = require('j2s');
const orm = require('./model');

module.exports =  {
    '/users': orm.User, // access control obeys 'defaultAccess'
    '/photos': {
        model: orm.Photo,
        C: J2S.ALLOW,
        R: {photo_id: id} // allow reads only when user.photo_id = photo.id
        // let updates and deletion obey 'defaultAccess'
    },
    '/books': {
        model: orm.Book,
        // allow updates on books only when the book is written by the request user
        U: (identity, instance) => {
            // here, 'identity' represents the request User, 'instance' represents a queried Book
            return identity.books().fetch().then(function(books) {
                return books.some(function(book) {
                    return book.id == instance.id
                })
            })
        }
    },
}
```


```javascript
// app.js
const orm = require('./model');
const J2S = require('j2s')
const j2s = new J2S({
    prefix: '/api',
    routes: require('./routes'),
    defaultAccess: {
        C: J2S.ALLOW,
        R: J2S.DENY,
        U: J2S.DENY,
        D: J2S.DENY
    }, // optional
    identity: function (request) {
        // should return an Promise that resolves to a Bookshelf.js model instance
        return orm.User.where({id: request.header.user_id}).fetch();
    } // optional, don't set this to ignore access control, defaults to allow all
})

const Koa = require('koa');
const app = new Koa();

app.use(j2s.routes());
app.use(j2s.allowedMethods());
```

### Access control

Configurations in routes allows you to determine whether a user could do CRUD on the resource.
a route with access control looks like following:

```javascript
{
    'path': {
        model: SomeBookshelfModel,
        C: strategy,
        R: strategy,
        U: strategy,
        D: strategy,
    }
}
```

You could omit any of the C, R, U, D, keys and they would behave as how you specified in `defaultAccess` option.


The strategy could be as following:
* `J2S.ALLOW`: Allow all access to the resource.
* `J2S.DENY`: Deny all access to the resource,
* `{identity_attr: 'target_attr'}`: Allow access when the `identity_attr` equals to `target_attr`, where `identity_attr` is an attribute on the model returned by the `identity` callback (normally an column in user table), and `target_attr` is an attribute on the resource the user wants to access. Useful for one-to-one and one-to-many relations.
* A callback function: You could use a function that returns a Promise that later resolves to true or false as the strategy. This is especially useful to design access control rules that relies on many-to-many relations.

If you don't want access control at all, you could set your routes as:

```javascript
{
    'path': SomeBookshelfModel
}
```


### Basic Query Examples

> NOTE: examples below only show fake data with fake model attributes merely for demonstration purpose, the actual attributes depends how you define your tables, either by manually creating tables or using knex migrations. Also, you could use Bookshelf triggers to hash password, examples here show plain text for simplicity.

* `GET hostname/api/users?query={"where":{"id":1}}`

    To get a user with id equals to 1.

    The result would be something like:
    ```json
    {
      "data": [
        {
          "id": 1,
          "username": "test1",
          "email": "test1@gmail.com",
          "password": "1234",
          "created_at": "2016-09-15T05:44:45.678Z",
          "updated_at": "2016-09-17T09:20:21.672Z"
        }
      ]
    }
    ```

    There is a shortcut to get one instance using id, above query is equal to
    `GET hostname/api/users/1`, but this only applies to GET method, and the resulting data would only
    contains an JSON object instead of a list, which is like:

    ```json
    {
      "data": {
        "id": 1,
        "username": "test1",
        "email": "test1@gmail.com",
        "password": "1234",
        "created_at": "2016-09-15T05:44:45.678Z",
        "updated_at": "2016-09-17T09:20:21.672Z"
      }
    }
    ```

* `GET hostname/api/users?query={"where":{"id__lt": "3", "username__ne": "test"}, "populate": ["photo"]}`

    To get users where id less than 3 and username not equal to "test", and populate the 'photo_id' foreign key with the related object.

    The result would be something like:

    ```json
    {
      "data": [
        {
          "id": 1,
          "username": "test1",
          "email": "test1@gmail.com",
          "password": "1234",
          "created_at": "2016-09-15T05:44:45.678Z",
          "updated_at": "2016-09-17T09:20:21.672Z",
          "photo": {
            "id": 3,
            "name": "test3.png",
            "url": "http://test.com/test3.png",
            "created_at": "2016-09-15T05:44:45.662Z",
            "updated_at": "2016-09-15T05:44:45.662Z"
          }
        },
        {
          "id": 2,
          "username": "test2",
          "email": "test2@gmail.com",
          "password": "1234",
          "created_at": "2016-09-15T05:44:45.679Z",
          "updated_at": "2016-09-17T09:20:21.672Z",
          "photo": {
            "id": 3,
            "name": "test3.png",
            "url": "http://test.com/test3.png",
            "created_at": "2016-09-15T05:44:45.662Z",
            "updated_at": "2016-09-15T05:44:45.662Z"
          }
        }
      ]
    }
    ```

* `POST hostname/api/users` with request body of type `application/json` as following:

    ```json
    {
        "data": [{
            "username": "test12",
            "email": "test12@test.com",
            "password": "1234",
            "photo_id": 3
        }, {
            "username": "test13",
            "email": "test13@test.com",
            "password": "1234",
            "photo_id": 3
        }]
    }
    ```

    will create an instance in user table, and returns following result:

    ```json
    {
      "data": [
        {
          "username": "test12",
          "email": "test12@test.com",
          "password": "1234",
          "photo_id": 3,
          "updated_at": "2016-09-18T16:32:41.013Z",
          "created_at": "2016-09-18T16:32:41.013Z",
          "id": 12
        },
        {
          "username": "test13",
          "email": "test13@test.com",
          "password": "1234",
          "photo_id": 3,
          "updated_at": "2016-09-18T16:32:41.332Z",
          "created_at": "2016-09-18T16:32:41.332Z",
          "id": 13
        }
      ]
    }
    ```

* `PUT hostname/api/users` with request body of type `application/json` as follwoing:

    ```json
    {
        "query": {
            "where": {
                "id__in": [1,2,3]
            }
        },
        "data": {
            "photo_id": 3
        }

    }
    ```

    will find instances that id is in the list [1,2,3], and updates their 'photo_id' to 3,
    results in the following response:

    ```json
    {
      "data": {
        "photo_id": 3,
        "updated_at": "2016-09-15T05:46:36.535Z"
      }
    }
    ```

* `DELETE hostname/api/users` with request body of type `application/json` as follwoing:

    ```json
    {
        "query": {
            "where": {
                "username": "test13"
            }
        }
    }
    ```

    will find the instance with username equals to "test13" and delete it, returns following response:

    ```json
    {
      "data": {}
    }
    ```

### Query Syntax

The `query` section for a request supports almost all the operations allowed in sql, composed with series of key value pairs.

Available top level keys are:

1. `where`: specifies query conditions,
    value example:
    ```json
    {"username": "hello"}
    ```
2. `select`: specifies which columns to select,
    value example:
    ```json
    ["id AS user_id", "username"]
    ```
3. `order_by`: order the results by a columns, desc, or asc,
    value example:
    ```json
    ["id", "desc"]
    ```
4. `limit`: limit the query result to certain number,
    value example:
    ```json
    10
    ```
5. `offset`: skip query result to certain number,
    value example:
    ```json
    10
    ```
6. `populate`: populates any foreign constraint relations with the values in the foreign table, you must define relations using Bookshelf on your own, like the `photo` function of `User` model in examples above.
    value example:
    ```json
    ["photo"]
    ```

7. joins: lots of joining operations are supported, available keywords including:
    `join`, `inner_join`, `left_join`, `left_outer_join`, `right_join`, `right_outer_join`, `full_outer_join`, `cross_join`.
    value example of a `join`:
    ```json
    {
        "photo": {
            "user.photo_id": "photo.id"
        }
    }
    ```
    which will join the "photo" table on the condition that "photo_id" column of the "user" table with value equal to the "id" column of the "photo" table. (the example assumes the querying table is the "user" table)

### Where Conditions Suffixes

You can use suffix appended after a column in a where condition to achieve advanced query clause.
Suffixes are appended after a column name followed by TWO underscores, like `user__gt`.

Available suffixes includes:

1. `gt`: greater than
2. `gte`: greater than or equal to
3. `lt`: less than
4. `lte`: less than or equal to
5. `ne`: not equal to
6. `between`: between two values
7. `not_between`: not between two values
8. `in`: in a list of values
9. `not_in`: not in a list of values
10. `null`: set to true to find records with null values on that column, or false to find  not null ones.
11. `or`: an OR operation, this special keyword allows recursive conditions parsing, all conditions inside an `or` JSON object are ANDed together, and these conditions are ORed with conditions with same level as the `or` keyword.
see [Advanced Examples](#advanced-examples)

### Advanced Examples

```json
{
    "where": {
        "user.id__gt": 1,
        "user.id__lt": 10,
        "user.id__between": [1, 10],
        "user.id__not_between": [11, 13],
        "username__ne": "yo",
        "username__in": ["test1", "test2", "test4", "test6"],
        "or": {
            "username": "test",
            "user.id__in": [1, 2, 3]
        }
    },
    "join": {
        "photo": {
            "user.photo_id": "photo.id"
        }
    },
    "populate": ["photo"],
    "select": ["user.id as user_id", "user.username", "photo.url as photo_url"],
    "limit": 10,
    "offset": 1,
    "order_by": ["user.id", "desc"]
}
```
