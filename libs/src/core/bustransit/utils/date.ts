export function addMilliseconds(date, milliseconds) {
    const newDate = new Date(date); // Tạo một bản sao để không thay đổi đối tượng gốc
    newDate.setMilliseconds(newDate.getMinutes() + milliseconds);
    return newDate;
}