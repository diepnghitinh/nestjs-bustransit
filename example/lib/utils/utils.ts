export function bufferToStringJson(buffer) {
    try {
        // Chuyển Buffer sang chuỗi (giả định encoding là UTF-8, bạn có thể điều chỉnh nếu cần)
        const stringData = buffer.toString('utf-8');

        // Cố gắng parse chuỗi JSON
        const jsonData = JSON.parse(stringData);

        return jsonData;
    } catch (error) {
        console.error('Lỗi khi chuyển Buffer sang JSON:', error);
        return null; // Hoặc bạn có thể throw error tùy theo yêu cầu
    }
}

export function getLastPart(message, separator = ':') {
    if (!message || typeof message !== 'string') {
        return null; // Hoặc throw new Error('Message không hợp lệ');
    }

    const parts = message.split(separator);
    if (parts.length > 0) {
        return parts[parts.length - 1];
    } else {
        return null; // Chuỗi rỗng
    }
}
