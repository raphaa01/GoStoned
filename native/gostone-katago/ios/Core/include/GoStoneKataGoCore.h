#ifndef GOSTONE_KATAGO_CORE_H
#define GOSTONE_KATAGO_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct GoStoneKataGoEngine GoStoneKataGoEngine;
typedef void (*GoStoneKataGoLineCallback)(const char *line, void *context);
typedef void (*GoStoneKataGoExitCallback)(int exit_code, const char *error, void *context);

const char *gostone_katago_version(void);
GoStoneKataGoEngine *gostone_katago_start(
    const char *model_path,
    const char *config_path,
    GoStoneKataGoLineCallback line_callback,
    GoStoneKataGoExitCallback exit_callback,
    void *context
);
int gostone_katago_send(GoStoneKataGoEngine *engine, const char *json_line);
void gostone_katago_stop(GoStoneKataGoEngine *engine);
void gostone_katago_destroy(GoStoneKataGoEngine *engine);

#ifdef __cplusplus
}
#endif

#endif
