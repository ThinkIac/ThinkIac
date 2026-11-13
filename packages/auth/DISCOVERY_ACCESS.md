# Discovery access contract

Packages can use `manifest.access` to bind a discovered view or runtime tool to
one of their own canonical permissions:

```json
{
  "manifest": {
    "access": {
      "views": { "Index": "providers.config.read" },
      "tools": { "saveProvider": "providers.config.write" }
    }
  }
}
```

`views` keys are Svelte view names without `.svelte`; `tools` keys are the
registered tool names. A declaration is valid only when its permission has the
same package prefix. Invalid declarations fail closed and do not grant access.

The Shell filters protected views from `GET /shell/apps/list`; the Agent filters
protected tools from `GET /agent/tools`. The catalog also carries
`requiredPermission` for trusted consumers. Lógos applies the declared view
permission to direct `/view/<package>/<view>` requests too, before rendering.
Widgets, menus, InputBar slots and Desktop contributions inherit the permission
of the view that provides them, so they are never exposed through the Shell
catalog when their view is denied. Tools must still validate the same permission
at their execution boundary.

Undeclared items remain discoverable during migration. New sensitive views and
tools should declare access before being published.
