# j2s

JSON to SQL, build RESTful API server that accepts JSON describing SQL query statements, and do CRUD accordingly.

Tired of creating API every time that front-end requires new feature?
Your front-end development always are lagged due to backend API not yet ready?
j2s provides extreme flexibility to let front-end compose powerful query statements via JSON,
and let backend do CRUD accordingly.

Supported JSON for a query will looks like:
```json
{
    "where": {
        "user.id__gt": 1,
        "user.id__lt": 10,
        "user.id__between": [1, 10],
        "user.id__not_between": [11, 13],
        "fb_token__null": true,
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
    "populate": ["photo", "devices"],
    "select": ["user.id as user_id", "user.username", "photo.url as photo_url"],
    "limit": 10,
    "offset": 1,
    "order_by": ["user.id", "desc"]
}
```
