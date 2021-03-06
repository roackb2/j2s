# j2s


# Agenda
* [Introduction](#introduction)
* [Usage](#usage)
    * [Access control](#access-control)
    * [Middlewares](#middlewares)
    * [Basic Query Examples](#basic-query-examples)
    * [Query Syntax](#query-syntax)
    * [Where Conditions Suffixes](#where-conditions-suffixes)
    * [Extra Attributes and Extra Clauses on query](#extra-attributes-and-extra-clauses-on-query)
        * [`add_attr`](#add_attr)
        * [`add_clause`](#add_clause)
    * [Relation Manipulation](#relation-manipulation)
    * [Advanced Examples](#advanced-examples)
    * [Use J2S Internal Methods](use-j2s-internal-methods)

> NOTE: since version 2.0.0, you have to use `new J2s().controller` to get the koa router instance. the J2S constructor will no longer return controller instance anymore.

# Introduction

JSON to SQL, build RESTful API server on the fly, which accepts JSON describing SQL query statements, and do CRUD accordingly, with configurable access control & pluggable middlewares.

* Tired of creating API every time that front-end requires new feature?
* Your front-end development always are lagged due to backend API not yet ready?
* API now immediately ready after you defines your model(and tables), no data query or fetching logic implementation needed!

j2s provides extreme flexibility to let front-end compose powerful query statements via JSON,
and let backend do CRUD accordingly, without adding ANY code to your backend (except for routing paths configs & corresponding ORM model definitions).

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
User has an many-to-many relation to Book, and User may have zero or one Account,
the Account model determines whether a user is administrator in its `is_admin` column.
Other model are fore examples for following sections.

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

    account: function() {
        return this.hasOne(Account, 'user_id');
    }

    photo: function() {
        return this.belongsTo(Photo, 'photo_id');
    },

    comments: function() {
        return this.hasMany(Comment, 'user_id');
    }

    books: function() {
        return this.belongsToMany(Book, 'user_book', 'user_id', 'book_id')
    }
})

const Account = bookshelf.Model.extend({
    tableName: 'account',

    user: function() {
        return this.belongsTo(User, 'user_id');
    }
})

const Photo = bookshelf.Model.extend({
    tableName: 'photo',
    hasTimestamps: true,

    uploader: function() {
        return this.belongsTo(User, 'user_id');
    }
})

const Book = bookshelf.Model.extend({
    tableName: 'book',
    hasTimestamps: true,

    authors: function() {
        return this.belongsToMany(User, 'user_book', 'book_id', 'user_id')
    }
})

const Comment = bookshelf.Model.extend({
    tableName: 'comment',
    hasTimestamps: true,

    author: function() {
        return this.belongsTo(User, 'user_id');
    }
})

module.exports = {
    bookshelf: bookshelf,
    User: User,
    Photo: Photo,
    Book: Book,
    Account: Account,
    Comment: Comment
}
```

> NOTE: For access control on relation manipulation to work properly, the `Target`, `foreignKey` and `otherKey` must be set on relations.

```javascript
// routes.js
const J2S = require('j2s');
const orm = require('./model');

module.exports =  {
    '/users': orm.User, // access control obeys 'access' in J2S default configurations
    '/photos': {
        model: orm.Photo,
        access: {
            C: J2S.ALLOW,
            R: {photo_id: id} // allow reads only when user.photo_id = photo.id
            // let updates and deletion obey 'defaultAccess'
        }
    },
    '/books': {
        model: orm.Book,
        middlewares: [], // ignore any middlewares
        access: {
            // allow updates on books only when the book is written by the request user
            U: (identity, instance, ctx) => {
                // here, 'identity' represents the request User, 'instance' represents a queried Book, and `ctx` is an optional Koa request context object.
                return identity.books().fetch().then(function(books) {
                    return books.some(function(book) {
                        return book.id == instance.id
                    })
                })
            }
        }
    },
    // do not expose the Account model to users
}
```


```javascript
// app.js
const orm = require('./model');
const J2S = require('j2s')
// J2S default configurations for all routes
const options = {
    prefix: '/api',                 // optional
    log: 'debug',                   // optional
    routes: require('./routes'),    // necessary
    bookshelf: orm.bookshelf        // necessary
    access: {
        C: J2S.ALLOW,
        R: J2S.DENY,
        U: J2S.DENY,
        D: J2S.DENY
    },                              // optional
    forbids: ['join', 'cross_join'] // optional
    middlewares: [async function (ctx, next) {
        // add an authentication middleware
        // assume that request header contains user ID and a given access token,
        // check that user with that token exists in database
        let user = await orm.User.where({
            id: ctx.request.header.user_id,
            token: ctx.request.header.token
        }).fetch();
        if (!user) {
            throw new Error('authentication fail')
        }
        await next();
    }],                              // optional
    identity: function (request) {
        // should return a Promise that resolves to a Bookshelf.js model instance
        return orm.User.where({id: request.header.user_id}).fetch();
    },  // optional, don't set this to ignore access control, defaults to allow all
    admin: function(identity) {
        // should return a Promise that resolves to true or false
        return identity.account().fetch().then(function(account) {
            if (!account) {
                return false;
            }
            return account.get('is_admin');
        })
    },  // optional, the admin callback allows some user to bypass all access control rules
}
const j2s = new J2S(options)
const controller = j2s.controller

const Koa = require('koa');
const app = new Koa();

app.use(controller.routes());
app.use(controller.allowedMethods());
```

>> NOTE: log levels follows the npm log levels as following:
```
{
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
  silly: 5
}
```
Now only the `verbose` level will print out SQL query statements
and `debug` level will print out more low level ones.

### Access control

Configurations in routes allows you to determine whether a user could do CRUD on the resource.
a route with access control looks like following:

```javascript
{
    'path': {
        model: SomeBookshelfModel,
        access: {
            C: strategy,
            R: strategy,
            U: strategy,
            D: strategy,
        }
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

### Middlewares

j2s allow any valid koa middleware to be run sequentially before running the CRUD, you could put any middleware you like, including authentication middlewares. You have following ways to setup middlewares.

* The `middlewares` in j2s options, e.g.
    ```javascript
    const J2S = require('j2s')
    const j2s = new J2S({
        middlewares: [function* (next) {
            // your middleware logic
        }],
        // .... other settings
    })
    ```

* The `middlewares` in routes, e.g.
    ```javascript
    '/some_route': {
        model: orm.SomeBookshelfModel,
        middlewares: [/* any number of middlewares here */],
        access: {
            C: J2S.ALLOW,
            R: J2S.ALLOW,
            U: J2S.ALLOW,
            D: J2S.ALLOW
        }
    },
    ```
    You could set `middlewares` to empty list to opt out all middlewares for a single route.

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
    `GET hostname/api/users/1`, but this only applies to GET method, you could also add the `query` query parameters to it, like `GET hostname/api/users/1?query={"populate":["comments"]}`, and the resulting data would only
    contains an JSON object instead of a list, which is like:

    ```json
    {
      "data": {
        "id": 1,
        "username": "test1",
        "email": "test1@gmail.com",
        "password": "1234",
        "created_at": "2016-09-15T05:44:45.678Z",
        "updated_at": "2016-09-17T09:20:21.672Z",
        "comments": [{
            "id": 1,
            "content": "some comment"
        }, {
            "id": 2,
            "content": "some other comment"
        }]
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
    {"username": "hello", "id__in": [1,2,3]}
    ```

    conditions could also be array of JSON objects,
    value example:
    ```json
    [{"username": "hello"}, {"id__in": [1,2,3]}]
    ```

2. `select`: specifies which columns to select,
    value example:
    ```json
    ["id AS user_id", "username"]
    ```
3. `from`: specifies which table to select from. Usually you won't need this, because the table to select from will be specified by resource path, but you might need this in a subquery.
    value example:
    ```json
    "user"
    ```
4. `order_by`: order the results by a columns, desc, or asc,
    value example:
    ```json
    ["id", "desc"]
    ```
    You could also do multiple column order by as following:
    ```json
    [["comment_count", "desc"], ["created_at", "desc"]]
    ```
5. `limit`: limit the query result to certain number,
    value example:
    ```json
    10
    ```
6. `offset`: skip query result to certain number,
    value example:
    ```json
    10
    ```
7. `as`: alias for a subquery.
    value example:
    ```json
    "user_id"
    ```
8. `with`: the `with` statement. The key will be the alias.
    value example:
    ```json
    {
        "jay_books": {
            "select": ["*"],
            "from": "book",
            "where": {
                "author": "jay"
            }
        }
    }
    ```
9. `populate`: populates any foreign constraint relations with the values in the foreign table, you must define relations using Bookshelf on your own, like the `photo` function of `User` model in examples above. The value of a population could also be an JSON object that contains nested query statements.
    value example:
    ```json
    ["photo"]
    ```

    or like following:
    ```json
    [{
        "photo": {
            "select": ["id", "url"]
        }
    }]
    ```

10. joins: lots of joining operations are supported, available keywords including:
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

    Joins could also contains subqueries, which might looks like:
    ```json
    {
        "photo": {
            "subquery": {
                "select": ["photo.uploader_id"],
                "group_by": "photo.uploader_id",
                "count": "photo.id AS upload_count"
            },
            "as": "uploads",
            "on": {
                "uploads.uploader_id": "user.id"
            }
        }
    }
    ```
    Above example assumes that every Photo has one or no user as the uploader, and the query could have `select: ["upload_count"]` to get values that how many photos each user uploads.


11. `union`: Union a subquery.
    value example:
    ```json
    {
        "select": ["*"],
        "from": "user"
    }
    ```
12. `union_all`: An UNION ALL operation on a subquery.
    value example:
    ```json
    {
        "select": ["*"],
        "from": "user"
    }
    ```
13. `group_by`: group by a column, need to be used along with aggregation methods.
    value example:
    ```json
    "photo_id"
    ```

14. `count`: count on a column.
    value example:
    ```json
    "id"
    ```

    `count` could also be a JSON Array to apply multiple count clauses as following:
    ```json
    ["id", "gender"]
    ```

15. `min`: get minimum value on a column.
    value example:
    ```json
    "badge"
    ```

16. `max`: get maximum value on a column.
    value example:
    ```json
    "badge"
    ```

17. `avg`: get average value on a column.
    value example:
    ```json
    "badge"
    ```

18. `exists`: an EXISTS subquery, see [Advanced Examples](#advanced-examples)

19. `not exists`: an NOT EXISTS subquery, see [Advanced Examples](#advanced-examples)

20. `and`: an AND operation, this special keyword allows recursive conditions parsing, all conditions inside an `and` JSON object are ANDed together. The conditions is recursively parsed as how j2s handles the `where` keyword.
    value example:
    ```json
    {"username": "hello", "id__in": [1,2,3]}
    ```

    conditions could also be array of JSON objects,
    value example:
    ```json
    [{"username": "hello"}, {"id__in": [1,2,3]}]
    ```


21. `or`: an OR operation, this special keyword allows recursive conditions parsing, all conditions inside an `or` JSON object are ORed together. The conditions is recursively parsed as how j2s handles the `where` keyword.
    value example:
    ```json
    {"username": "hello", "id__in": [1,2,3]}
    ```

    conditions could also be array of JSON objects,
    value example:
    ```json
    [{"username": "hello"}, {"id__in": [1,2,3]}]
    ```

22. `add_attr`: for custom attributes that need to do more database queries or any asynchronous operations, the `add_attr` keyword provides the capability to define custom functions that return promises on model prototypes, then APIs will resolve these functions and set the result as a same-named attribute on returned data. See [Extra Attributes and Extra Clauses on query](#extra-attributes-and-extra-clauses-on-query)

23. `add_clause`: for adding extra database query clause that is pre-defined by backend, which might lower down front-ends' burden or adds ability that is forbidden for front-ends to do. See [Extra Attributes and Extra Clauses on query](#extra-attributes-and-extra-clauses-on-query)


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
11. `like`: like a string, case sensitive. The value is automatically wrapped inside a pair of percentage symbols, to achive substring match. For example, `{like: 'apple'}` would be equivalent to `like '%apple%'` SQL statement.
12. `not_like`: not like a string, case sensitive. The value is also automatically wrapped inside a pair of percentage symbols.
13. `ilike`: like a string, case insensitive (PostgreSQL only).
14. `not_ilike`: not like a string, case insensitive (PostgreSQL only).
15. `reg_like`: a POSIX regex match statement, case sensitive (PostgreSQL only).
16. `reg_not_like`: a POSIX regex not match statement, case sensitive (PostgreSQL only).
17. `reg_ilike`: a POSIX regex match statement, case insensitive (PostgreSQL only).
18. `reg_not_ilike`: a POSIX regex not match statement, case insensitive (PostgreSQL only).

### Extra Attributes and Extra Clauses on query

j2s allows backend developers to define some extra functions on model class and model prototype, then when front-end queries, they could specify what clause or attribute they want to add, to add extra information or extra query conditions when j2s executes the query, via the `add_attr` and `add_clause` keywords.

#### `add_attr`
Conecpt of `add_attr` is that, backend developer defines some member functions on the bookshelf model prototype, then when instances are fetched from database according to the query conditions, j2s executes the member function on *EACH* instance that has been queried, and add one more attributes on the object in the response. It's useful when that you need some extra attributes or column on the response object that needs complicated logic or DB operations or any asynchronous operations.

For example, the backend defines following methods on Post model prototype:

```javascript
const Comment = bookshelf.Model.extend({
    tableName: 'comment';
})

const Post = bookshelf.Model.extend({
    tableName: 'post',

    comments: function() {
        return this.hasMany(Comment);
    }
})

/**
 * has_comment - check that whether the post has one or more comments;
 *
 * @param {Context} ctx koa context object
 *
 * @return {boolean} boolean indicates whether the post has one or more comments;
 */
Post.prototype.has_comment = async function(ctx) {
    let count = await this.comments().query().count();
    return count !== 0;
}
```

And the front-end sends the query `GET hostname/users?query={"add_attr":["has_comment"]}`,
the server would respond something like following:

```json
{
    "data": [
        {
            "id": 1,
            "content": "oh so this is how add_attr means!",
            "has_comment": true
        },
        {
            "id": 2,
            "content": "it means you'll get one more attributes named `has_comment` on each object",
            "has_comment": false
        }
    ]
}
```


#### `add_clause`

Concept of add_clause is that, the backend developer could define some member function on the bookshelf model class, then when j2s receives a request, it would add some extra query clauses to the query object *BEFORE* it executes the query. it's useful when you want to reduce the burden to figure out how to write a complicate SQL query for the front-end developers, or some keywords like `join` is forbidden to be used for the front-ends, then backend could take care of it.

For example, front-end sends `GET host/users?query={"add_clause":["filter_active"]}`

and backend defines following method on the User model:

```javascript
const User = core.bookshelf.Model.extend({
    tableName: 'user'
})

/**
 * filter_active - filter out the users that is active, which means that the user's email has been verified, and the deletion flag is not set on the user, assuming there are two columns `email_verified` and `deleted` in the user table
 *
 * @param {Context} ctx     the koa context object
 * @param {object}  query   the JSON object that represents the query
 *
 * @return {object} should return the modified query object
 */
User.filter_active = async function(ctx, query) {
    if (!_.has(query, 'where')) {
        query.where = {};
    }
    query.where.email_verified == true;
    query.where.deleted = false;
    return query;
}
```

then the server may response something like following:
```json
{
    "data": [
        {
            "id": 1,
            "username": "bob",
            "email_verified": true,
            "deleted": false
        }, {
            "id": 2,
            "username": "evan",
            "email_verified": true,
            "deleted": false
        }
    ]
}
```

### Relation Manipulation

When using `POST` to create objects or `PUT` to update objects, you could add, remove, replace or create some relations, like `PUT hostname/api/users` with following body:

```json
{
	"query": {
		"where": {
			"username": "test1"
		}
	},
	"data": {
        "account": 1,
        "photo": {
            "url": "https://some.where.com"
        },
		"comments": {
			"remove": [1,2,3],
			"add": [4,5],
			"create": [{
				"content": "test-comment-1",
			}, {
				"content": "test-comment-2",
			}]
		}
	}
}
```

would look for user who's username is 'test1', sets its account to the one with id equal to 1, create a photo with given payload for the user, cancel the relations with comments with id 1, 2, 3, and add relations with comments with id 4 and 5, then create two comments for this user.

For one-to-one relations, including `hasOne`, `belongsTo`, `morphOne`, `morphTo`, the value for the relation name key could be number or JSON object. if number is given, j2s would look for the target relation and sets the foreign key on the target object or the queried instance, depending on the relation type. If object is given, j2s would create a new object and relates the two instances.


For one-to-many and many-to-many relations, including `hasMany`, `belongsTo`, `morphMany`, `belongsToMany`, the value for a relation name is an JSON object, contains following keys, each one is optional:

- `add`: value is array of ids, target objects should be existing, this only sets the foreign key on the target objects.
- `remove`: value is array of ids, target relation should be existing, this only unset the foreign key on the target objects.
- `create`: value is array of objects, this will create some objects and build the relations.
- `replace`: value is array of ids, all existing relations would be cancelled and new relations would be added, its equivalent to calling `remove` with all existing relations then call `add` to add some new relations.

> NOTE: you could not have the key `replace` in the relation payload along with other keys at the same time, but you could have `add`, `remove`, `create` all together in the relation payload.

### Advanced Examples

```json
{
    "where": {
        "user.id__gt": 1,
        "user.id__lt": 10,
        "and": [{
            "username__in": ["test1", "test2", "test4", "test6"]
        }, {
            "username__ne": "yo"
        }],
        "or": {
            "user.id__between": [1, 10],
            "user.id__not_between": [11, 13],
        },
        "exists": {
            "photo": {
                "user.photo_id": "photo.id"
            }
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
    "order_by": [[
        "user.id", "desc"
    ], [
        "user.created_at", "desc"
    ]]
}
```

### Use J2S Internal Methods

From version 2.0.2, you could use some J2S internal methods to do CRUD on resources.
These methods are used by J2S to parse the queries and handle resource CRUD, and by exposing them,
developers have more control over customization if you want to do some manipulation on the query
that front-end sends in. Currently, following methods are available on a J2S instance:

- `getOpts`: Get the options that j2s uses when handling a resource CRUD. The parameter should be the path corresponds to the resource you are going to manipulate.

    example:
    ```javascript
    let opts = j2s.getOpts('/users');
    ```
- `getOptsWithModel`: Get the options that j2s uses when handling a resource CRUD. The parameter should be the Bookshelf Model that corresponds to the resource you are going to manipulate

    example:
    ```javascript
    let opts = j2s.getOptsWithModel(User);
    ```    
- `getInstances`: Get instances from database. The parameters should includes an Koa context instance, the query to be passed in, and options resolved by using `getOpts` or `getOptsWithModel`.

    example:
    ```javascript
    controller.get('/users_with_pagination', async (ctx, next) => {
        let template = {select: ["user.id", "user.username"]};
        let query = ctx.request.query.query;
        query = JSON.parse(query);
        let {
            limit,
            offset,
        } = query;
        let mergedQuery = merge(template, {
            limit,
            offset
        })
        let opts = j2s.getOptsWithModel(User);
        let instances = await j2s.getInstances(ctx, mergedQuery, opts);
        ctx.body = {data: instances}
    })
    ```
- `createInstances`: Create instances.

    example:
    ```javascript
    controller.post('/create_user', async (ctx, next) => {
        let data = ctx.request.body.data;
        let opts = j2s.getOptsWithModel(User);
        let instances = await j2s.createInstances(ctx, data, opts);
        ctx.body = {data: instances}
    })
    ```
- `updateInstances`: Update instances.

    example:
    ```javascript
    controller.put('/update_user', async (ctx, next) => {
        let query = ctx.request.body.query
        let data = ctx.request.body.data;
        let opts = j2s.getOptsWithModel(User);
        let res = await j2s.updateInstances(ctx, query, data, opts);
        ctx.body = {data: res}
    })
    ```
