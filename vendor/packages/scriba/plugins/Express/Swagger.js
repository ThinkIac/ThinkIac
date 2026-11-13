import express from "express";
import swaggerUi from "swagger-ui-express";
import OpenAPI from "./OpenAPI.js";

// import { SwaggerTheme, SwaggerThemeNameEnum } from'swagger-themes';
// const theme = new SwaggerTheme();

export default function SwaggerUI(scriba, tenantId) {
    const router = express.Router();

    router.get("/openapi.json", (req, res) => {
        res.json(OpenAPI(scriba, tenantId));
    });

    const swaggerOptions = {
        // explorer: true,
        customCss: `
        .topbar, .info { display: none; }
        `,
    };

    router.use(
        "/",
        swaggerUi.serve,
        swaggerUi.setup(null, {
            ...swaggerOptions,
            swaggerOptions: {
                url: "openapi.json"
            }
        })
    );

    return router;
}
