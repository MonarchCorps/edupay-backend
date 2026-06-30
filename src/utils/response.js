export function success(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}

export function paginated(res, data, total, page, pageSize) {
    return res.status(200).json({
        success: true,
        data,
        pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        },
    });
}

export function error(res, message, code, status = 400) {
    return res
        .status(status)
        .json({ success: false, error: { code, message } });
}
